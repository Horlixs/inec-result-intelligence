import json
import requests

_original_get = requests.get
_original_request = requests.request


def debug_get(url, *args, **kwargs):
    print(json.dumps({"console":"GET","url":url,"params":kwargs.get("params"),"timeout":kwargs.get("timeout")}))
    try:
        response = _original_get(url, *args, **kwargs)
        print(json.dumps({"console":"GET_RESULT","url":url,"status":response.status_code,"content_type":response.headers.get("content-type"),"bytes":len(response.content),"body_preview":response.text[:500]}))
        return response
    except Exception as exc:
        print(json.dumps({"console":"GET_ERROR","url":url,"error":str(exc)}))
        raise


def debug_request(method, url, *args, **kwargs):
    print(json.dumps({"console":"REQUEST","method":method,"url":url,"params":kwargs.get("params"),"timeout":kwargs.get("timeout")}))
    try:
        response = _original_request(method, url, *args, **kwargs)
        print(json.dumps({"console":"REQUEST_RESULT","method":method,"url":url,"status":response.status_code,"content_type":response.headers.get("content-type"),"bytes":len(response.content),"body_preview":response.text[:500]}))
        return response
    except Exception as exc:
        print(json.dumps({"console":"REQUEST_ERROR","method":method,"url":url,"error":str(exc)}))
        raise


requests.get = debug_get
requests.request = debug_request

print(json.dumps({"console":"ENV","SUPABASE_URL":bool(__import__('os').environ.get('SUPABASE_URL')),"SUPABASE_SERVICE_ROLE_KEY":bool(__import__('os').environ.get('SUPABASE_SERVICE_ROLE_KEY')),"IREV_KEY":bool(__import__('os').environ.get('IREV_KEY')),"GOOGLE_GENERATIVE_AI_API_KEY":bool(__import__('os').environ.get('GOOGLE_GENERATIVE_AI_API_KEY'))}))

from paddle_ocr_worker import main

main()
