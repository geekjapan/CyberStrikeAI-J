---
name: binary-mobile-reversing
description: >-
  APK/EXE/binaries: UniApp/DCloud/Flutter reverse engineering, certificate pinning bypass, exported components, memory-corruption exploit chains, IoT firmware. Use when reversing APK/EXE, UniApp/Flutter, native .so, or memory-corruption exploits.
metadata:
  tags: [penetration-testing, red-team]
---

## APK / EXE / Binary Reverse Engineering

```
=== APK/EXE/Binary ===
APK: apktool d / jadx | Check Manifest for exported components/deeplink/debuggable | rg hardcoded keys + API addresses | .so strings/Ghidra | frida/objection for dynamic analysis
🚨UniApp/DCloud APK reversing (H5 hybrid app, all business logic is in JS, not in DEX):
  Identify: __UNI__XXXXXXX + assets/apps/ + uni-jsframework.js (NOT Flutter, no libapp.so) | manifest.json contains a "uni-app" field
  Core file: assets/apps/__UNI__XXX/www/app-service.js (800KB+ obfuscated JS = all business logic) | jadx only shows the shell (native plugin registration), the real logic is in the JS
  JS deobfuscation (RC4 + string array rotation): extract the a0G() big array (10000+ elements) + the a0m(idx,key) decode function (base64→RC4) + the rotation IIFE → assemble executable JS → batch-decode with node → JSON dictionary (offset→plaintext)
    🔴Pitfall: the rotation IIFE may end with a comma (not a semicolon! it is part of a larger expression) → node reports "Unexpected token" → extract up to the actual terminator
  Encrypted config zlsioh.dat/dcloud3.dat: header (96B offset table: off40=block1 decompressed size/44=compressed size/60=block2 offset/64=block2 size/80=block3 offset) + block1 (zlib→DEX) + block2 (encrypted, contains the API domain list ← key target, needs .so to decrypt) + block3 (zlib→AndroidX class mapping)
    zlib magic 78DA = not encrypted, decompress directly | no magic = encrypted block (key is in the .so .rodata / assembly immediates)
  .so string deobfuscation: extract even-position characters→reverse (e.g. "mAojcl.dubdFiHaebP.nwywfwb"→"www.baidu.com") | strings -n8 lib*.so to find long strings containing dots
  ⚠️Pitfalls: x-separated IP strings in the .so (e.g. "x111.230.69.120x118.126.105.164") = DCloud HTTPDNS nodes (NOT the API backend! 140.205.11.x=Alibaba Cloud DNS, 111.230/118.126/106.52/42.193=Tencent Cloud) | resources.arsc errors are deliberate decompilation protection (do not affect jadx) | fake PNGs in assets (1-8px) = integrity checks, not data | fcapp.run is only an APK download proxy
  Key API variables: $apiHost/$opHost (set dynamically at runtime, not hardcoded)/urlList/checkAvailableDomainList (HEAD domain/favicon.ico to test connectivity, 200-399=available)
  High-value endpoints: /app_init /user/gustRegister (guest registration without verification) /user/getOssSts (temporary OSS credentials!) /uploadFile2
  Config: manifest.json (appId/version/nativePlugins→wrs-httpserver=embedded HTTP server!) | supplierconfig.json (vivo/xiaomi/huawei/oppo appid) | dcloud_uniplugins.json (plugin list)
  ChengZi SDK (Chengzi site builder): the init3 endpoint returns JSON encrypted with single-byte XOR (key=0x96, see chengzi_decrypt.py) → decrypt to get the real APK download link (fu field) + channel code
  Domain fallback: when $apiHost cannot be obtained statically → Android emulator (Waydroid/AVD) + tcpdump/mitmproxy to capture runtime DNS
  See: references/uniapp-apk-reverse-engineering.md, references/uniapp-apk-reversing.md, scripts/js_rc4_deobfuscate.js, scripts/chengzi_decrypt.py
🚨Flutter APK quick reversing (no unpacking needed): hardening (MogoSec/Bangcle/360) protects the DEX layer, but Flutter's lib/arm64-v8a/libapp.so (Dart AOT) is usually not encrypted
  strings -n8 libapp.so|grep 'https\?://' → all hardcoded URLs/API domains/S3 addresses/CDN
  strings -n8 libapp.so|grep -E '^/' → API path matrix (/Member/Login, /Web/VideoList, /BBS/GetSTSToken, etc.)
  strings -n8 libapp.so|grep -iE 'key|secret|token|aws|bucket' → credential/key leaks
  assets/config_*.xml + assets/data_*.dat → encrypted config (may contain domains/API addresses) | .DS_Store → macOS developer information leak | assets/xinstall* → channel tracking SDK
🚨Native .so string deobfuscation (general pattern): obfuscated strings are in the .rodata section
  Common patterns: even-position character extraction + reversal (e.g. "mAojcl.dubdFiHaebP..."→take even positions→reverse = plaintext domain) | XOR constants | RC4+base64
  Identify: strings -n8 lib*.so to find equal-length 16-byte strings (AES key/IV) / strings containing dots (domains) / x-separated IP strings (HTTPDNS) | nm --dynamic to find obfuscated exported symbols (16 random mixed-case characters)
  Verify: compare known strings ("classes.dex"/"io.dcloud.application") with their obfuscated versions → infer the algorithm → batch decode
🚨General mobile (regular apps that are neither UniApp nor Flutter):
  Certificate pinning bypass (to capture HTTPS): objection android sslpinning disable | frida universal-unpinning | edit smali to remove pinning and repackage
  Exported component privilege abuse: Activity/Service/Provider/Receiver with Manifest exported=true → drozer/adb am start cross-app calls | ContentProvider SQLi/path traversal
  Deeplink hijacking: unvalidated scheme:// → WebView loads arbitrary URL (XSS/file read) | parameters passed into intent → component hijacking
  Insecure storage: /data/data/pkg/ (plaintext tokens in shared_prefs/unencrypted db/logcat leaks) | world-readable sdcard
  WebView: addJavascriptInterface (<4.2 RCE)/file:// local read/setAllowFileAccess | Static: MobSF does it all in one go | iOS: decrypt the app (frida-ios-dump) + Ghidra for Mach-O + objection for dynamic analysis
EXE/PE: file/strings | Ghidra/IDA decompile to find hardcoded values/crypto/network logic | x64dbg dynamic debugging | Vulnerabilities: overflow/format string/UAF/DLL hijacking
🚨Memory-corruption exploit chain (crash → RCE): checksec to check mitigations → identify the primitive (stack overflow/UAF/format string = arbitrary read/write)
  → information leak to bypass ASLR → ROP chain (ROPgadget/pwntools ret2libc) → heap exploitation (tcache poison/__free_hook hijack)
  → arbitrary write to overwrite GOT/hook/vtable/exit_funcs → control-flow hijack | Firmware/IoT: binwalk -Me extraction + qemu-user debugging (weak mitigations, often a direct stack overflow)
```
