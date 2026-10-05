"""Runtime compatibility fixes for the PaddleOCR worker.

This module is imported automatically by Python when the repository root is on
sys.path.  It keeps the existing worker unchanged while normalising PaddleOCR
v3/v5 result shapes before the worker consumes them.
"""

from __future__ import annotations


def _flatten_box(box):
    """Return a JSON-safe [x1, y1, x2, y2] box when possible."""
    if isinstance(box, (list, tuple)):
        if len(box) >= 4 and all(isinstance(value, (int, float)) for value in box[:4]):
            return [box[0], box[1], box[2], box[3]]
        if len(box) == 1:
            return _flatten_box(box[0])
        if len(box) >= 4 and all(isinstance(value, (list, tuple)) for value in box[:4]):
            points = []
            for point in box[:4]:
                if len(point) >= 2 and all(isinstance(value, (int, float)) for value in point[:2]):
                    points.append((point[0], point[1]))
            if len(points) == 4:
                xs = [point[0] for point in points]
                ys = [point[1] for point in points]
                return [min(xs), min(ys), max(xs), max(ys)]
    return box


def _normalise_payload(payload):
    if not isinstance(payload, dict):
        return payload
    target = payload.get("res") if isinstance(payload.get("res"), dict) else payload
    boxes = target.get("rec_boxes")
    if isinstance(boxes, (list, tuple)):
        target["rec_boxes"] = [_flatten_box(box) for box in boxes]
    return payload


try:
    import paddleocr

    _OriginalPaddleOCR = paddleocr.PaddleOCR
    _original_predict = _OriginalPaddleOCR.predict

    class _ResultProxy:
        def __init__(self, result):
            self._result = result

        def _raw(self):
            value = getattr(self._result, "json", None)
            if callable(value):
                value = value()
            if value is None:
                value = getattr(self._result, "res", None)
            return _normalise_payload(value)

        @property
        def json(self):
            return self._raw

        @property
        def res(self):
            return self._raw()

        def __getattr__(self, name):
            return getattr(self._result, name)

    def _safe_predict(self, *args, **kwargs):
        for result in _original_predict(self, *args, **kwargs):
            yield _ResultProxy(result)

    _OriginalPaddleOCR.predict = _safe_predict
except Exception:
    # Never prevent the worker from starting if PaddleOCR changes its import
    # surface. The normal worker error handling will report the real issue.
    pass
