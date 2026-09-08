#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
飞书多维表格 <-> 工作台 批处理同步脚本（纯标准库，无需 pip）

跨租户访问用 user_access_token（OAuth 授权码流程）：以登录用户身份访问另一个企业的多维表格。
首次运行需授权一次（临时监听 127.0.0.1:8778 收 code），之后用 refresh_token 直接跑，无常驻进程。

用法：
  python3 server/feishu_sync.py -e workspace_export.json -o workspace_export_synced.json
  # -e 工作台「导出备份」得到的文件；-o 合并后产物，回工作台「导入恢复」即可
  # -m/--mode: sync(默认) | pull(仅飞书->工作台) | push(仅工作台->飞书)

飞书应用需在开发者后台：
  1) 安全设置 -> 重定向URL 加 http://127.0.0.1:8778/oauth/callback
  2) 权限管理在「用户身份权限(user_access_token)」下开通 bitable:app（读写）并发布
授权流程：authorize 走 https://accounts.feishu.cn/open-apis/authen/v1/authorize；
换 token/刷新 走 https://open.feishu.cn/open-apis/authen/v2/oauth/token。
"""
import argparse
import json
import os
import sys
import time
import threading
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
CFG_PATH = os.path.join(HERE, 'config.json')
TOKEN_PATH = os.path.join(HERE, 'token.json')
REDIRECT_URI = 'http://127.0.0.1:8778/oauth/callback'

API = 'https://open.feishu.cn/open-apis'
AUTH = 'https://accounts.feishu.cn/open-apis/authen/v1/authorize'


def log(*a):
    print('[feishu_sync]', *a, flush=True)


# ---------- 配置 / 令牌 ----------
def load_cfg():
    with open(CFG_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)


def load_token():
    try:
        with open(TOKEN_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {'access_token': None, 'refresh_token': None, 'expire_at': 0}


def save_token(tk):
    with open(TOKEN_PATH, 'w', encoding='utf-8') as f:
        json.dump(tk, f, ensure_ascii=False, indent=2)


# ---------- 飞书 HTTP ----------
def feishu_get(path, token):
    req = urllib.request.Request(API + path, headers={'Authorization': 'Bearer ' + token})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode('utf-8'))


def feishu_send(path, token, method='POST', body=None):
    data = json.dumps(body or {}).encode('utf-8')
    req = urllib.request.Request(API + path, data=data, method=method,
                                 headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode('utf-8'))


# ---------- OAuth ----------
_oauth_code = None
_oauth_event = threading.Event()


class _Cb(BaseHTTPRequestHandler):
    def do_GET(self):
        global _oauth_code
        q = urllib.parse.urlparse(self.path).query
        p = urllib.parse.parse_qs(q)
        if 'code' in p:
            _oauth_code = p['code'][0]
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write('<h2 style="font-family:sans-serif;padding:24px">飞书授权成功 ✅，可关闭此页</h2>'.encode('utf-8'))
            _oauth_event.set()
        else:
            self.send_response(400)
            self.end_headers()

    def log_message(self, *a):
        pass


def do_oauth(cfg):
    app_id = cfg['feishu_api']['app_id']
    app_secret = cfg['feishu_api']['app_secret']
    scopes = ' '.join(cfg.get('scopes', ['bitable:app'])) + ' offline_access'
    q = urllib.parse.urlencode({'client_id': app_id, 'response_type': 'code', 'redirect_uri': REDIRECT_URI, 'scope': scopes, 'state': 'wb_sync'})
    url = AUTH + '?' + q
    try:
        srv = ThreadingHTTPServer(('127.0.0.1', 8778), _Cb)
    except OSError as e:
        log('！无法在 127.0.0.1:8778 启动本地回调服务：', e)
        log('  端口可能被上次卡住的脚本占用。请在本机终端执行：')
        log('    lsof -ti:8778 | xargs kill -9')
        log('  清理后重跑；若本机开了代理(OpenSurge/mihomo 等)，请先把 127.0.0.1、localhost 加入「绕过代理/直连」，否则授权回调会被代理拦截。')
        sys.exit(1)
    log('请在新开的浏览器页登录【在目标企业有编辑权限】的账号并同意授权：')
    log(url)
    log('提示：本机若开了代理(OpenSurge/mihomo)，请把 127.0.0.1 与 localhost 加入绕过列表，否则授权后回调会被代理拦截导致卡住。')
    try:
        webbrowser.open(url)
    except Exception:
        log('（未能自动打开浏览器，请手动复制上面 URL 到浏览器打开）')
    log('等待授权回调（临时监听 8778，授权后自动关闭）…')
    if not _oauth_event.wait(timeout=1800):
        srv.shutdown()
        log('未收到浏览器自动回调。可手动补齐：')
        log('  请在浏览器地址栏复制完整的回调地址（形如 http://127.0.0.1:8778/oauth/callback?code=XXXX），')
        log('  或仅复制 code 字符串，粘贴到下方后回车：')
        try:
            raw = input('code/URL> ').strip()
        except EOFError:
            raw = ''
        if raw:
            if 'code=' in raw:
                _oauth_code = urllib.parse.parse_qs(urllib.parse.urlparse(raw).query).get('code', [''])[0]
            else:
                _oauth_code = raw
        if not _oauth_code:
            log('未提供 code，退出'); sys.exit(1)
    srv.shutdown()
    # 换 token（v2 endpoint，响应字段在顶层）
    body = {'grant_type': 'authorization_code', 'code': _oauth_code, 'client_id': app_id, 'client_secret': app_secret, 'redirect_uri': REDIRECT_URI}
    req = urllib.request.Request(API + '/authen/v2/oauth/token', data=json.dumps(body).encode('utf-8'),
                                 method='POST', headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r:
        j = json.loads(r.read().decode('utf-8'))
    if j.get('code') != 0:
        log('换取 token 失败：', j.get('msg')); sys.exit(1)
    tk = {'access_token': j['access_token'], 'refresh_token': j.get('refresh_token'), 'expire_at': time.time() + j.get('expires_in', 7200)}
    save_token(tk)
    log('授权成功，token 已保存')
    return tk


def get_token(cfg):
    tk = load_token()
    if tk.get('access_token') and time.time() < tk['expire_at'] - 60:
        return tk['access_token']
    if tk.get('refresh_token'):
        app_id = cfg['feishu_api']['app_id']
        app_secret = cfg['feishu_api']['app_secret']
        body = {'grant_type': 'refresh_token', 'refresh_token': tk['refresh_token'], 'client_id': app_id, 'client_secret': app_secret}
        req = urllib.request.Request(API + '/authen/v2/oauth/token', data=json.dumps(body).encode('utf-8'),
                                     method='POST', headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=30) as r:
            j = json.loads(r.read().decode('utf-8'))
        if j.get('code') == 0:
            tk = {'access_token': j['access_token'], 'refresh_token': j.get('refresh_token', tk['refresh_token']),
                  'expire_at': time.time() + j.get('expires_in', 7200)}
            save_token(tk)
            return tk['access_token']
    # 需要重新授权
    return do_oauth(cfg)['access_token']


# ---------- 字段映射 ----------
FS_COL = {
    'title': '任务名称', 'priority': '优先级', 'status': '状态', 'deadline': '截止日期',
    'customer': '客户名称', 'module': '业务模块', 'owner': '任务归属',
    'note': '备注', 'wbId': '工作台ID'
}


def ts_to_ms(v):
    if not v:
        return 0
    if isinstance(v, (int, float)):
        return int(v * 1000) if v < 1e11 else int(v)
    s = str(v).strip()
    if s.isdigit():
        n = int(s)
        return n * 1000 if n < 1e11 else n
    try:
        return int(datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp() * 1000)
    except Exception:
        return 0


def fs_priority_to_wb(val, opts):
    if not val:
        return 'P1'
    v = str(val).upper()
    m = {'P0': 'P0', 'P1': 'P1', 'P2': 'P2', '高': 'P0', '紧急': 'P0', '中': 'P1', '重要': 'P1', '低': 'P2', '一般': 'P2'}
    return m.get(v, 'P1')


def wb_priority_to_fs(prio, opts):
    if not opts:
        return prio
    want = {'P0': ['P0', '高', '紧急'], 'P1': ['P1', '中', '重要'], 'P2': ['P2', '低', '一般']}.get(prio, [prio])
    for o in want:
        if o in opts:
            return o
    return opts[0]


def fs_status_to_done(val):
    if not val:
        return False
    return '已完成' in str(val)


def wb_done_to_fs(done, opts):
    if not opts:
        return '已完成' if done else '待办'
    if done:
        for o in opts:
            if '已完成' in o:
                return o
        return '已完成'
    for o in opts:
        if '已完成' not in o:
            return o
    return opts[0]


def resolve_module_by_customer(projects, cust, mod):
    if not cust:
        return None
    c = cust.strip()
    for p in (projects or []):
        if not p.get('customer') or p['customer'].strip() != c:
            continue
        for m in (p.get('modules') or []):
            if m.get('name') and m['name'].strip() == (mod or '').strip():
                return m['id']
    return None


def customer_module_of(projects, module_id):
    for p in (projects or []):
        for m in (p.get('modules') or []):
            if m.get('id') == module_id:
                return p.get('customer', ''), m.get('name', '')
    return '', ''


# ---------- 主同步 ----------
def main():
    ap = argparse.ArgumentParser(description='飞书多维表格 <-> 工作台 批处理同步')
    ap.add_argument('-e', '--export', default='workspace_export.json', help='工作台导出的 JSON')
    ap.add_argument('-o', '--output', default='workspace_export_synced.json', help='合并后产物')
    ap.add_argument('-m', '--mode', default='sync', choices=['sync', 'pull', 'push'])
    args = ap.parse_args()

    cfg = load_cfg()
    app_token = cfg['bitable']['app_token']
    table_id = cfg['bitable']['table_id']
    token = get_token(cfg)

    # 读字段
    fields = feishu_get(f'/bitable/v1/apps/{app_token}/tables/{table_id}/fields?page_size=500', token).get('items', [])
    field_names = {f['field_name'] for f in fields}
    prio_opts = next((f['property']['options'] for f in fields if f['field_name'] == FS_COL['priority'] and f.get('property', {}).get('options')), []) or []
    prio_opts = [o['name'] for o in prio_opts]
    status_opts = next((f['property']['options'] for f in fields if f['field_name'] == FS_COL['status'] and f.get('property', {}).get('options')), []) or []
    status_opts = [o['name'] for o in status_opts]

    def has(name):
        return name in field_names

    # 拉记录
    recs = []
    page = None
    while True:
        qs = urllib.parse.urlencode({'page_size': 500, 'page_token': page} if page else {'page_size': 500})
        d = feishu_get(f'/bitable/v1/apps/{app_token}/tables/{table_id}/records?{qs}', token)
        recs.extend(d.get('items', []))
        page = d.get('page_token') if d.get('has_more') else None
        if not page:
            break
    log(f'飞书记录数：{len(recs)}')

    # 读工作台 state
    with open(args.export, 'r', encoding='utf-8') as f:
        state = json.load(f).get('data', {})
    projects = state.get('projects', [])
    tasks = state.get('tasks', [])

    by_feishu = {t['feishuId']: t for t in tasks if t.get('feishuId')}
    by_wb = {t['id']: t for t in tasks if t.get('id')}

    # 1) Pull
    if args.mode in ('sync', 'pull'):
        created = updated = 0
        for r in recs:
            f = r.get('fields', {})
            rid = r['record_id']
            t = by_feishu.get(rid)
            if not t and has(FS_COL['wbId']) and f.get(FS_COL['wbId']) and by_wb.get(f[FS_COL['wbId']]):
                t = by_wb[f[FS_COL['wbId']]]
                t['feishuId'] = rid
            if not t:
                cust = f.get(FS_COL['customer'], '').strip() if has(FS_COL['customer']) else ''
                exist = next((x for x in tasks if not x.get('feishuId') and x.get('title', '').strip() == (f.get(FS_COL['title'], '') or '').strip()
                               and (cust == (customer_module_of(projects, x.get('moduleId'))[0] if x.get('moduleId') else ''))), None) if cust else None
                if exist:
                    t = exist
                    t['feishuId'] = rid
            if not t:
                cust = f.get(FS_COL['customer'], '').strip() if has(FS_COL['customer']) else ''
                mod = f.get(FS_COL['module'], '').strip() if has(FS_COL['module']) else ''
                mid = resolve_module_by_customer(projects, cust, mod)
                fs_ts = ts_to_ms(r.get('last_modified_time'))
                t = {
                    'id': 't_' + rid, 'title': (f.get(FS_COL['title'], '') or '').strip() or '未命名任务',
                    'priority': fs_priority_to_wb(f.get(FS_COL['priority']), prio_opts) if has(FS_COL['priority']) else 'P1',
                    'deadline': (f.get(FS_COL['deadline'], '')[:10] or None) if has(FS_COL['deadline']) else None,
                    'moduleId': mid, 'completed': fs_status_to_done(f.get(FS_COL['status'])) if has(FS_COL['status']) else False,
                    'completedAt': None, 'createdAt': int(time.time() * 1000), 'updatedAt': fs_ts or int(time.time() * 1000),
                    'deferredCount': 0, 'deferredDates': [],
                    'note': (f.get(FS_COL['note'], '') or '') if has(FS_COL['note']) else '',
                    'feishuId': rid, 'feishuUpdatedAt': int((fs_ts or time.time() * 1000) / 1000),
                    'feishuCustomer': cust, 'feishuModule': mod,
                }
                tasks.append(t)
                created += 1
                continue
            fs_ts = ts_to_ms(r.get('last_modified_time'))
            if fs_ts >= (t.get('updatedAt') or 0):
                cand = {
                    'title': (f.get(FS_COL['title'], '') or '').strip() or '未命名任务',
                    'priority': fs_priority_to_wb(f.get(FS_COL['priority']), prio_opts) if has(FS_COL['priority']) else 'P1',
                    'deadline': (f.get(FS_COL['deadline'], '')[:10] or None) if has(FS_COL['deadline']) else None,
                    'completed': fs_status_to_done(f.get(FS_COL['status'])) if has(FS_COL['status']) else False,
                    'note': (f.get(FS_COL['note'], '') or '') if has(FS_COL['note']) else '',
                    'feishuCustomer': f.get(FS_COL['customer'], '').strip() if has(FS_COL['customer']) else '',
                    'feishuModule': f.get(FS_COL['module'], '').strip() if has(FS_COL['module']) else '',
                }
                cust = cand['feishuCustomer']; mod = cand['feishuModule']
                t['moduleId'] = resolve_module_by_customer(projects, cust, mod)
                t.update(cand)
                t['updatedAt'] = fs_ts
                t['feishuUpdatedAt'] = int(fs_ts / 1000)
                updated += 1
        log(f'Pull：新增 {created} / 更新 {updated}')

    # 2) Push
    if args.mode in ('sync', 'push'):
        pushed = 0
        for t in tasks:
            fields_out = {}
            if has(FS_COL['title']):
                fields_out[FS_COL['title']] = t.get('title', '')
            if has(FS_COL['priority']):
                fields_out[FS_COL['priority']] = wb_priority_to_fs(t.get('priority', 'P1'), prio_opts)
            if has(FS_COL['status']):
                fields_out[FS_COL['status']] = wb_done_to_fs(t.get('completed', False), status_opts)
            if has(FS_COL['deadline']) and t.get('deadline'):
                fields_out[FS_COL['deadline']] = t['deadline']
            c, m = customer_module_of(projects, t.get('moduleId'))
            if has(FS_COL['customer']) and c:
                fields_out[FS_COL['customer']] = c
            if has(FS_COL['module']) and m:
                fields_out[FS_COL['module']] = m
            if has(FS_COL['note']) and t.get('note'):
                fields_out[FS_COL['note']] = t['note']
            if has(FS_COL['wbId']):
                fields_out[FS_COL['wbId']] = t.get('id')
            try:
                if t.get('feishuId'):
                    feishu_send(f'/bitable/v1/apps/{app_token}/tables/{table_id}/records/{t["feishuId"]}', token, method='PUT', body={'fields': fields_out})
                else:
                    rec = feishu_send(f'/bitable/v1/apps/{app_token}/tables/{table_id}/records', token, method='POST', body={'fields': fields_out})
                    t['feishuId'] = rec['data']['record']['record_id']
                    t['feishuUpdatedAt'] = int(time.time())
                pushed += 1
            except Exception as e:
                log(f'  Push 跳过 {t.get("title")}: {e}')
        log(f'Push：{pushed} 条')

    state['tasks'] = tasks
    out = {'version': '1.0', 'exportDate': datetime.now().strftime('%Y-%m-%d'), 'data': state}
    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    log(f'已写出合并文件：{args.output}（回工作台「导入恢复」即可）')


if __name__ == '__main__':
    main()
