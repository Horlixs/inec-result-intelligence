import base64
import hashlib
import json
import os
import re
import sys
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any

import requests
from paddleocr import PaddleOCR

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
GEMINI_KEY = os.environ.get("GOOGLE_GENERATIVE_AI_API_KEY", "").strip()
IREV_KEY = os.environ.get("IREV_KEY", "").strip()
IREV_BASE = "https://dolphin-app-sleqh.ondigitalocean.app/api/v1"
WORKER_ID = f"paddle-ocr:{uuid.uuid4()}"
MAX_ATTEMPTS = 3


def rest(path: str, method: str = "GET", params=None, payload=None):
    response = requests.request(
        method,
        f"{SUPABASE_URL}/rest/v1/{path}",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
        params=params,
        json=payload,
        timeout=45,
    )
    if not response.ok:
        raise RuntimeError(f"Supabase {method} {path} HTTP {response.status_code}: {response.text[:1000]}")
    return response.json() if response.text else None


def rpc(name: str, payload: dict):
    return rest(f"rpc/{name}", method="POST", payload=payload)


def finish_job(job_id: str, attempts: int, ok: bool, error: str | None = None):
    if ok:
        rest(
            f"result_processing_jobs?id=eq.{job_id}",
            method="PATCH",
            payload={
                "status": "completed",
                "locked_at": None,
                "locked_by": None,
                "last_error": None,
                "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            },
        )
    else:
        terminal = attempts >= MAX_ATTEMPTS
        rest(
            f"result_processing_jobs?id=eq.{job_id}",
            method="PATCH",
            payload={
                "status": "failed" if terminal else "queued",
                "locked_at": None,
                "locked_by": None,
                "last_error": error[:2000] if error else "Unknown PaddleOCR error",
                "available_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + (900 if not terminal else 0))),
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            },
        )


def resolve_live_irev_source(sheet: dict) -> str | None:
    source = str(sheet.get("source_url") or "").strip()
    route_pu_id = ""
    match = re.search(r"/elections/([^/]+)/pu/([^/]+)/document", source)
    if match:
        route_pu_id = match.group(2)
        election_external_id = match.group(1)
    else:
        election_rows = rest(
            f"elections?id=eq.{sheet['election_id']}&select=external_id"
        )
        if not election_rows or not election_rows[0].get("external_id"):
            return None
        election_external_id = str(election_rows[0]["external_id"])

    pu_rows = rest(
        f"polling_units?id=eq.{sheet['polling_unit_id']}&select=external_id,ward_id,irev_pu_id,pu_code,name"
    )
    if not pu_rows:
        return None
    pu = pu_rows[0]
    ward_rows = rest(
        f"wards?id=eq.{pu['ward_id']}&select=irev_ward_oid,irev_ward_id"
    )
    if not ward_rows or not ward_rows[0].get("irev_ward_oid"):
        return None
    ward_oid = str(ward_rows[0]["irev_ward_oid"])

    election_external_id = re.sub(r"^irev:", "", election_external_id, flags=re.I)

    headers = {
        "User-Agent": "INEC-Result-Intelligence/1.0 paddle-ocr-worker",
        "Accept": "application/json, text/plain, */*",
        "Origin": "https://inecelectionresults.ng",
        "Referer": "https://inecelectionresults.ng/",
        **({"x-api-key": IREV_KEY} if IREV_KEY else {}),
        "x-api-rt": str(int(time.time() * 1000)),
    }

    def api_rows(payload):
        if isinstance(payload, list):
            return [row for row in payload if isinstance(row, dict)]
        if isinstance(payload, dict):
            for key in ("data", "polling_units", "pus", "results", "items"):
                value = payload.get(key)
                if isinstance(value, list):
                    return [row for row in value if isinstance(row, dict)]
                if isinstance(value, dict):
                    nested = api_rows(value)
                    if nested:
                        return nested
        return []

    def fetch_pus(target_ward_oid):
        response = requests.get(
            f"{IREV_BASE}/elections/{requests.utils.quote(election_external_id, safe='')}/pus",
            params={"ward": target_ward_oid},
            headers=headers,
            timeout=30,
        )
        response.raise_for_status()
        return api_rows(response.json())

    rows = fetch_pus(ward_oid)
    if not rows:
        hierarchy = requests.get(
            f"{IREV_BASE}/elections/{requests.utils.quote(election_external_id, safe='')}/lga",
            headers=headers,
            timeout=30,
        )
        hierarchy.raise_for_status()
        hierarchy_payload = hierarchy.json()
        lgas = hierarchy_payload.get("data", []) if isinstance(hierarchy_payload, dict) else []
        if not isinstance(lgas, list):
            lgas = []
        ward_numeric = None
        ward_numeric_raw = ward_rows[0].get("irev_ward_id")
        try:
            ward_numeric = int(ward_numeric_raw)
        except (TypeError, ValueError):
            pass
        matched_oid = None
        for lga in lgas:
            if not isinstance(lga, dict):
                continue
            for ward in lga.get("wards", []) if isinstance(lga.get("wards"), list) else []:
                if not isinstance(ward, dict):
                    continue
                candidate_oid = str(ward.get("_id") or "").strip()
                candidate_numeric = ward.get("ward_id", ward.get("id"))
                try:
                    candidate_numeric = int(candidate_numeric)
                except (TypeError, ValueError):
                    candidate_numeric = None
                if (candidate_oid and candidate_oid.lower() == ward_oid.lower()) or (ward_numeric is not None and candidate_numeric == ward_numeric):
                    matched_oid = candidate_oid or None
                    break
            if matched_oid:
                break
        if matched_oid and matched_oid.lower() != ward_oid.lower():
            rows = fetch_pus(matched_oid)

    target_external = str(pu.get("external_id") or "").strip()
    target_code = str(pu.get("pu_code") or "").strip().lower()
    target_name = re.sub(r"\s+", " ", str(pu.get("name") or "").strip().lower())
    target_numeric = int(pu["irev_pu_id"]) if str(pu.get("irev_pu_id") or "").isdigit() else None

    def inspect(value):
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, dict):
            for key in ("document_url", "backup_url", "file_url", "url", "src", "path", "href"):
                found = inspect(value.get(key))
                if found:
                    return found
            for key in ("document", "result", "result_sheet", "file"):
                found = inspect(value.get(key))
                if found:
                    return found
        return None

    # Do not accept the first loose match. IReV rows can contain several
    # identifiers and stale numeric ids; rank exact identifiers so an exact
    # polling-unit code/external id wins over a coincidental numeric match.
    matches = []
    for row in rows:
        nested = row.get("polling_unit") if isinstance(row.get("polling_unit"), dict) else {}
        ids = [str(row.get(k) or "").strip() for k in ("polling_unit_oid", "external_id", "_id")]
        ids += [str(nested.get(k) or "").strip() for k in ("_id", "external_id")]
        numeric = row.get("pu_id", row.get("polling_unit_id", row.get("id", nested.get("polling_unit_id"))))
        try:
            numeric = int(numeric)
        except (TypeError, ValueError):
            numeric = None
        code = str(row.get("pu_code") or nested.get("pu_code") or row.get("code") or nested.get("code") or "").strip().lower()
        name = re.sub(r"\s+", " ", str(row.get("name") or row.get("polling_unit_name") or nested.get("name") or "").strip().lower())

        score = 0
        match_reason = None
        if route_pu_id and route_pu_id in ids:
            score, match_reason = 100, "route_pu_id"
        elif target_external and target_external in ids:
            score, match_reason = 90, "external_id"
        elif target_code and code and target_code == code:
            score, match_reason = 80, "pu_code"
        elif target_numeric is not None and numeric == target_numeric:
            score, match_reason = 70, "numeric_id"
        elif target_name and name and target_name == name:
            score, match_reason = 60, "name"

        if score:
            document = inspect(row.get("document") or row.get("result") or row.get("result_sheet") or row.get("file") or row)
            if document and document.startswith(("http://", "https://")):
                matches.append((score, match_reason, row, document))

    if not matches:
        return None

    best_score = max(item[0] for item in matches)
    best = [item for item in matches if item[0] == best_score]
    unique_documents = {item[3] for item in best}
    if len(unique_documents) > 1:
        raise RuntimeError(
            f"IReV polling-unit match is ambiguous for {target_code or target_external or target_numeric}: "
            f"{len(unique_documents)} documents matched at identifier priority {best_score}"
        )

    score, match_reason, row, document = best[0]
    print(json.dumps({
        "console": "IREV_MATCHED_PU",
        "target_numeric": target_numeric,
        "target_code": target_code,
        "match_reason": match_reason,
        "match_score": score,
        "matched_keys": sorted(str(k) for k in row.keys()),
        "document_id": row.get("document_id"),
        "document": row.get("document"),
        "result": row.get("result"),
        "result_sheet": row.get("result_sheet"),
        "file": row.get("file"),
        "file_url": row.get("file_url"),
        "document_url": row.get("document_url"),
        "url": row.get("url"),
        "href": row.get("href"),
        "old_documents": row.get("old_documents"),
    }, default=str))
    return document


def download_source(sheet: dict) -> tuple[bytes, str, str]:
    url = sheet.get("evidence_url") or sheet.get("source_url")
    if not url:
        raise RuntimeError("Result sheet has no evidence/source URL")

    # Legacy docs.inecelectionresults.net assets can be unreachable even when
    # the live IReV API still exposes the polling-unit document URL. Resolve
    # the live document directly before attempting the legacy asset.
    try:
        live_url = resolve_live_irev_source(sheet)
        if live_url:
            url = live_url
    except Exception as exc:
        print(json.dumps({"source_resolution_warning": str(exc)}))
    headers = {
        "User-Agent": "INEC-Result-Intelligence/1.0 paddle-ocr-worker",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,application/pdf,text/html;q=0.8,*/*;q=0.5",
        "Referer": "https://inecelectionresults.ng/",
    }
    response = None
    last_error = None
    for attempt in range(1, 5):
        try:
            candidate = requests.get(url, headers=headers, timeout=45)
            if candidate.ok:
                response = candidate
                break
            last_error = f"IReV HTTP {candidate.status_code}: {candidate.text[:1000]}"
            if candidate.status_code not in {408, 425, 429, 500, 502, 503, 504}:
                candidate.raise_for_status()
        except requests.RequestException as exc:
            last_error = str(exc)
        if attempt < 4:
            time.sleep(2 ** (attempt - 1))
    if response is None:
        raise RuntimeError(last_error or "IReV source request failed")
    content = response.content
    mime = (response.headers.get("content-type") or "").split(";")[0].lower()

    if content.startswith(b"%PDF-"):
        return content, "application/pdf", response.url
    if content.startswith(b"\xff\xd8\xff"):
        return content, "image/jpeg", response.url
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return content, "image/png", response.url
    if content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return content, "image/webp", response.url

    if "html" in mime or b"<html" in content[:1000].lower():
        text = content.decode("utf-8", errors="ignore")
        links = re.findall(r'(?:href|src)=["\']([^"\']+)["\']', text, flags=re.I)
        candidates = []
        for link in links:
            if not link.startswith(("http://", "https://")):
                link = requests.compat.urljoin(response.url, link)
            if re.search(r"\.pdf(?:$|[?#])|download|document|result", link, flags=re.I):
                candidates.append(link)
        for asset in candidates:
            try:
                asset_response = requests.get(asset, headers={"User-Agent": "INEC-Result-Intelligence/1.0 paddle-ocr-worker", "Referer": response.url}, timeout=30)
                if not asset_response.ok:
                    continue
                data = asset_response.content
                asset_mime = (asset_response.headers.get("content-type") or "").split(";")[0].lower()
                if data.startswith(b"%PDF-"):
                    return data, "application/pdf", asset_response.url
                if data.startswith(b"\xff\xd8\xff"):
                    return data, "image/jpeg", asset_response.url
                if data.startswith(b"\x89PNG"):
                    return data, "image/png", asset_response.url
                if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
                    return data, "image/webp", asset_response.url
                if asset_mime.startswith("image/") or asset_mime == "application/pdf":
                    return data, asset_mime, asset_response.url
            except requests.RequestException:
                continue
    raise RuntimeError("IReV source did not expose a supported PDF or image asset")


def materialize_images(data: bytes, mime: str, temp: Path) -> list[Path]:
    if mime != "application/pdf":
        suffix = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}.get(mime, ".img")
        path = temp / f"source{suffix}"
        path.write_bytes(data)
        return [path]

    import fitz

    pdf = fitz.open(stream=data, filetype="pdf")
    paths: list[Path] = []
    for index in range(len(pdf)):
        page = pdf[index]
        pix = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0), alpha=False)
        path = temp / f"page-{index + 1}.png"
        pix.save(str(path))
        paths.append(path)
    if not paths:
        raise RuntimeError("PDF contains no renderable pages")
    return paths


def ocr_images(paths: list[Path]) -> tuple[list[dict[str, Any]], float]:
    ocr = PaddleOCR(
        ocr_version="PP-OCRv5",
        lang="en",
        use_doc_orientation_classify=True,
        use_doc_unwarping=True,
        use_textline_orientation=True,
        engine="paddle",
    )
    lines: list[dict[str, Any]] = []
    scores: list[float] = []
    for page_index, path in enumerate(paths):
        for result in ocr.predict(input=str(path)):
            raw = getattr(result, "json", None)
            if callable(raw):
                raw = raw()
            if raw is None:
                raw = getattr(result, "res", None)
            if isinstance(raw, str):
                raw = json.loads(raw)
            if not isinstance(raw, dict):
                continue
            payload = raw.get("res", raw)
            texts = payload.get("rec_texts", [])
            rec_scores = payload.get("rec_scores", [])
            boxes = payload.get("rec_boxes", [])
            for i, text in enumerate(texts):
                value = str(text).strip()
                if not value:
                    continue
                score = float(rec_scores[i]) if i < len(rec_scores) else 0.0
                box = boxes[i] if i < len(boxes) else None
                lines.append({"page": page_index + 1, "text": value, "confidence": round(score, 4), "box": box})
                scores.append(score)
    return lines, (sum(scores) / len(scores) if scores else 0.0)


def structure_with_gemini(lines: list[dict[str, Any]], image_paths: list[Path]) -> dict[str, Any]:
    if not GEMINI_KEY:
        raise RuntimeError("GOOGLE_GENERATIVE_AI_API_KEY is required for result structuring after PaddleOCR")
    ordered_lines = sorted(
        lines,
        key=lambda line: (
            int(line.get("page", 0)),
            float((line.get("box") or [[0, 0, 0, 0]])[0][1]) if line.get("box") else 0.0,
            float((line.get("box") or [[0, 0, 0, 0]])[0][0]) if line.get("box") else 0.0,
        ),
    )
    ocr_text = "\n".join(
        f"[page {line['page']} | OCR confidence {line['confidence']:.3f} | box {line.get('box')}] {line['text']}"
        for line in ordered_lines
    )
    prompt = """You are structuring OCR output from an INEC Nigerian polling-unit result sheet.\nReturn ONLY JSON matching this schema:\n{\"pollingUnitName\":string|null,\"pollingUnitCode\":string|null,\"registeredVoters\":number|null,\"accreditedVoters\":number|null,\"rejectedVotes\":number|null,\"candidates\":[{\"label\":string,\"votes\":number|null}],\"confidence\":number}\nRules: never invent missing values; preserve uncertain handwritten candidate labels literally; do not silently correct OCR text; use null when a value cannot be established; votes must be integers or null; confidence is your confidence in the structured extraction, not OCR confidence. Candidate rows should include every candidate/result label that can be identified."""
    parts = [{"text": prompt + "\n\nOCR output:\n" + ocr_text}]
    for image_path in image_paths:
        image_bytes = image_path.read_bytes()
        parts.append({
            "inlineData": {
                "mimeType": "image/png",
                "data": base64.b64encode(image_bytes).decode("ascii"),
            }
        })
    body = {
        "contents": [{"parts": parts}],
        "generationConfig": {"temperature": 0, "responseMimeType": "application/json", "maxOutputTokens": 2048},
    }
    last_error = None
    for attempt in range(1, 5):
        try:
            response = requests.post(
                "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
                headers={"Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY},
                json=body,
                timeout=60,
            )
            if response.ok:
                text = response.json().get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text")
                if not text:
                    raise RuntimeError("Gemini returned no structured extraction")
                return json.loads(text)

            last_error = f"Gemini HTTP {response.status_code}: {response.text[:1000]}"
            if response.status_code not in {408, 425, 429, 500, 502, 503, 504}:
                response.raise_for_status()
        except (requests.RequestException, json.JSONDecodeError, RuntimeError) as exc:
            last_error = str(exc)

        if attempt < 4:
            delay = 3 * (2 ** (attempt - 1))
            print(json.dumps({"gemini_retry": attempt, "delay_seconds": delay, "error": last_error}))
            time.sleep(delay)

    raise RuntimeError(last_error or "Gemini structuring failed")


def validate(extracted: dict[str, Any]) -> tuple[bool, list[dict[str, Any]]]:
    issues: list[dict[str, Any]] = []
    candidates = extracted.get("candidates") if isinstance(extracted.get("candidates"), list) else []
    if not candidates:
        issues.append({"code": "no_candidate_rows", "severity": "error"})
    labels = set()
    for candidate in candidates:
        label = str(candidate.get("label") or "").strip()
        if not label:
            issues.append({"code": "candidate_label_missing", "severity": "error"})
            continue
        key = label.lower()
        if key in labels:
            issues.append({"code": "duplicate_candidate_label", "severity": "error", "label": label})
        labels.add(key)
        votes = candidate.get("votes")
        if votes is not None and (not isinstance(votes, int) or votes < 0):
            issues.append({"code": "candidate_votes_invalid", "severity": "error", "label": label, "votes": votes})
    registered = extracted.get("registeredVoters")
    accredited = extracted.get("accreditedVoters")
    rejected = extracted.get("rejectedVotes")
    if isinstance(registered, int) and isinstance(accredited, int) and accredited > registered:
        issues.append({"code": "accredited_exceeds_registered", "severity": "error"})
    known = [c.get("votes") for c in candidates if isinstance(c.get("votes"), int) and c.get("votes") >= 0]
    if isinstance(accredited, int) and len(known) == len(candidates):
        total = sum(known) + (rejected if isinstance(rejected, int) else 0)
        if total > accredited:
            issues.append({"code": "candidate_votes_exceed_accredited", "severity": "error", "total": total, "accredited": accredited})
    return not any(x["severity"] == "error" for x in issues), issues


def process(job: dict[str, Any]) -> None:
    sheet_id = job["result_sheet_id"]
    sheet_rows = rest(f"result_sheets?id=eq.{sheet_id}&select=*")
    if not sheet_rows:
        raise RuntimeError("Result sheet not found")
    sheet = sheet_rows[0]
    rest(f"result_sheets?id=eq.{sheet_id}", method="PATCH", payload={"status": "downloaded", "evidence_status": "processing", "last_error": None})

    with tempfile.TemporaryDirectory(prefix="irev-paddle-") as directory:
        temp = Path(directory)
        data, mime, asset_url = download_source(sheet)
        source_hash = hashlib.sha256(data).hexdigest()
        paths = materialize_images(data, mime, temp)
        lines, ocr_confidence = ocr_images(paths)
        if not lines:
            raise RuntimeError("PaddleOCR returned no readable text")
        extracted = structure_with_gemini(lines, paths)
        candidates = extracted.get("candidates") if isinstance(extracted.get("candidates"), list) else []
        valid, issues = validate(extracted)
        structure_confidence = float(extracted.get("confidence") or 0)
        combined_confidence = round(min(ocr_confidence, structure_confidence), 4)
        status = "verified" if valid and combined_confidence >= 0.85 else "pending_review"

        extraction = rest(
            "extractions",
            method="POST",
            payload={
                "result_sheet_id": sheet_id,
                "engine": "paddleocr-gemini",
                "engine_version": "PP-OCRv5 + Gemini structurer",
                "raw_output": {**extracted, "ocr_engine": "PaddleOCR", "ocr_lines": lines},
                "confidence": combined_confidence,
                "status": status,
            },
        )[0]
        extraction_id = extraction["id"]
        entries = [
            {
                "extraction_id": extraction_id,
                "label": str(candidate.get("label") or "").strip(),
                "votes": candidate.get("votes"),
                "raw_label": str(candidate.get("label") or "").strip(),
                "raw_value": None if candidate.get("votes") is None else str(candidate.get("votes")),
            }
            for candidate in candidates
            if str(candidate.get("label") or "").strip()
        ]
        if entries:
            rest("result_entries", method="POST", payload=entries)
        rest("validation_checks", method="POST", payload=[
            {"extraction_id": extraction_id, "check_name": "deterministic_result_validation", "passed": valid, "severity": "info" if valid else "error", "details": {"issues": issues, "candidate_count": len(candidates)}},
            {"extraction_id": extraction_id, "check_name": "ocr_confidence", "passed": ocr_confidence >= 0.70, "severity": "info", "details": {"engine": "PaddleOCR", "confidence": ocr_confidence}},
            {"extraction_id": extraction_id, "check_name": "extraction_confidence_range", "passed": 0 <= structure_confidence <= 1, "severity": "error", "details": {"confidence": structure_confidence}},
            {"extraction_id": extraction_id, "check_name": "source_sha256_recorded", "passed": bool(source_hash), "severity": "info", "details": {"sha256": source_hash, "source_url": sheet.get("source_url"), "evidence_url": asset_url, "mime_type": mime}},
        ])
        rest(f"result_sheets?id=eq.{sheet_id}", method="PATCH", payload={
            "status": status,
            "evidence_status": "remote_only",
            "source_hash": source_hash,
            "storage_path": None,
            "mime_type": mime,
            "evidence_url": asset_url,
            "evidence_size_bytes": len(data),
            "processed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "last_error": None,
        })


MAX_JOBS_PER_RUN = 3


def main() -> int:
    processed = 0
    failed = 0

    # Drain several queued jobs in one worker invocation. GitHub Actions starts
    # this workflow every three minutes; processing only one job per invocation
    # left a growing queue even though the worker was healthy.
    for _ in range(MAX_JOBS_PER_RUN):
        job_rows = rpc("claim_result_processing_job", {"p_worker_id": WORKER_ID, "p_max_attempts": MAX_ATTEMPTS, "p_engine": "paddle"})
        if not job_rows:
            if processed == 0 and failed == 0:
                print("No PaddleOCR job available")
            break

        job = job_rows[0]
        try:
            process(job)
            finish_job(job["job_id"], int(job["attempts"]), True)
            processed += 1
            print(json.dumps({"ok": True, "job_id": job["job_id"], "result_sheet_id": job["result_sheet_id"], "processed_in_run": processed}))
        except Exception as exc:
            message = str(exc)
            failed += 1
            try:
                rest(f"result_sheets?id=eq.{job['result_sheet_id']}", method="PATCH", payload={"status": "pending_review", "evidence_status": "remote_only", "last_error": message[:2000]})
            finally:
                finish_job(job["job_id"], int(job["attempts"]), False, message)
            print(json.dumps({"ok": False, "job_id": job["job_id"], "error": message}), file=sys.stderr)
            # Do not stop the drain because one bad sheet should not block the queue.
            continue

    print(json.dumps({"ok": failed == 0, "processed": processed, "failed": failed, "worker": WORKER_ID}))
    return 0 if processed > 0 or failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
