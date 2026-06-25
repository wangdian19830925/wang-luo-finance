#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import http.server
import socketserver
import os
import sys

PORT = 8123
PROJECT_DIR = "/Users/wangdian/Workbuddy/2026-06-24-13-33-38/资产管理工具开发"

os.chdir(PROJECT_DIR)

class UTF8Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # 允许 file:// 来源和跨源，方便开发
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()
    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

class ReuseTCPServer(socketserver.TCPServer):
    allow_reuse_address = True
    allow_reuse_port = True

with ReuseTCPServer(("", PORT), UTF8Handler) as httpd:
    print(f"Serving {PROJECT_DIR} at http://127.0.0.1:{PORT}/")
    httpd.serve_forever()
