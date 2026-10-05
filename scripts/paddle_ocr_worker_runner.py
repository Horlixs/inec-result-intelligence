from __future__ import annotations

import json

import scripts.paddle_ocr_worker as worker


def _normalize_box(box):
    if box is None:
        return None
    try:
        if len(box) >= 4 and all(isinstance(v, (int, float)) for v in box[:4]):
            x1, y1, x2, y2 = map(float, box[:4])
            return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]
        if len(box) >= 4 and all(isinstance(v, (list, tuple)) and len(v) >= 2 for v in box[:4]):
            return [[float(v[0]), float(v[1])] for v in box[:4]]
    except (TypeError, IndexError, ValueError):
        pass
    return None


def _box_xy(box):
    if not box:
        return (0.0, 0.0)
    try:
        return float(box[0][0]), float(box[0][1])
    except (TypeError, IndexError, ValueError):
        return (0.0, 0.0)


def ocr_images(paths):
    ocr = worker.PaddleOCR(
        ocr_version="PP-OCRv5",
        lang="en",
        use_doc_orientation_classify=True,
        use_doc_unwarping=True,
        use_textline_orientation=True,
        engine="paddle",
    )
    lines = []
    scores = []
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
            texts = payload.get("rec_texts", []) or []
            rec_scores = payload.get("rec_scores", []) or []
            boxes = payload.get("rec_boxes", []) or []
            for i, text in enumerate(texts):
                value = str(text).strip()
                if not value:
                    continue
                try:
                    score = float(rec_scores[i]) if i < len(rec_scores) else 0.0
                except (TypeError, ValueError):
                    score = 0.0
                box = _normalize_box(boxes[i]) if i < len(boxes) else None
                lines.append({
                    "page": page_index + 1,
                    "text": value,
                    "confidence": round(score, 4),
                    "box": box,
                    "box_xy": _box_xy(box),
                })
                scores.append(score)
    return lines, (sum(scores) / len(scores) if scores else 0.0)


_original_download_source = worker.download_source
_seen_sources = {}


def download_source(sheet):
    data, mime, url = _original_download_source(sheet)
    pu_id = str(sheet.get("polling_unit_id") or "")
    previous = _seen_sources.get(url)
    if previous and previous != pu_id:
        raise RuntimeError(
            f"IReV document collision: source URL {url} was already assigned to polling unit {previous} and cannot be reused for {pu_id}"
        )
    _seen_sources[url] = pu_id
    return data, mime, url


worker.ocr_images = ocr_images
worker.download_source = download_source


if __name__ == "__main__":
    raise SystemExit(worker.main())
