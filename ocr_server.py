#!/usr/bin/env python3
"""
验证码识别本地服务 - 基于 ddddocr
Chrome 扩展会将验证码图片发送到此服务进行识别
启动方式: python3 ocr_server.py
"""

import base64
import io
import json
from http.server import HTTPServer, BaseHTTPRequestHandler

import ddddocr

# 初始化 OCR 引擎，限制字符集为纯英文数字，大幅提升简单验证码精度
ocr = ddddocr.DdddOcr(show_ad=False)
# 6 = 小写+大写+数字
ocr.set_ranges(6)

PORT = 19999


class OCRHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        """处理 CORS 预检请求"""
        self.send_response(200)
        self._set_cors_headers()
        self.end_headers()

    def do_POST(self):
        if self.path == '/ocr':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)

            try:
                data = json.loads(body)
                base64_str = data.get('image', '')

                # 去掉 data:image/xxx;base64, 前缀
                if ',' in base64_str:
                    base64_str = base64_str.split(',', 1)[1]

                img_bytes = base64.b64decode(base64_str)
                result = ocr.classification(img_bytes)

                self.send_response(200)
                self._set_cors_headers()
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'success': True,
                    'text': result
                }).encode())

                print(f"[OCR] 识别结果: {result}")

            except Exception as e:
                self.send_response(500)
                self._set_cors_headers()
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'success': False,
                    'error': str(e)
                }).encode())
                print(f"[OCR] 识别出错: {e}")
        else:
            self.send_response(404)
            self.end_headers()

    def _set_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def log_message(self, format, *args):
        # 简化日志输出
        pass


if __name__ == '__main__':
    server = HTTPServer(('127.0.0.1', PORT), OCRHandler)
    print(f"✅ 验证码识别服务已启动: http://127.0.0.1:{PORT}/ocr")
    print("   等待 Chrome 扩展发送识别请求...")
    print("   按 Ctrl+C 停止服务")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n🛑 服务已停止")
        server.server_close()
