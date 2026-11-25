---
name: cloud-attack-methods
description: >-
  Cloud attacks: metadata API, S3/K8s, AWS/Azure/GCP privilege escalation, MinIO matrix, Aliyun FC, ChengZi SDK decryption. Use when attacking cloud metadata, IAM, K8s, MinIO, Aliyun FC, or cloud post-ex.
metadata:
  tags: [penetration-testing, red-team]
---

## Cloud attack techniques

```
=== Cloud ===
Metadata API: AWS 169.254.169.254/latest/meta-data/iam/ | Azure -H Metadata:true | GCP metadata.google.internal | Aliyun 100.100.100.200
Object storage: aws s3 ls --no-sign-request | K8s: /var/run/secrets/.../token → api/v1 to read secrets / exec into pods → cluster-admin
🚨Cloud identity attacks (escalation and lateral movement after obtaining a key/token):
  AWS: enumerate-iam/cloudfox/ScoutSuite to enumerate permissions → pacu to auto-find privesc (iam:PassRole+lambda/ec2/glue and 18+ more) | STS AssumeRole cross-account | steal keys from Lambda environment variables
  Azure/Entra: roadtools (roadrecon tenant dump)/AADInternals | device code/refresh tokens | steal a Managed Identity token via IMDS | Automation Runbook RCE | read keys from Key Vault
  Entra post-exploitation: GraphRunner (Graph API enumeration/mail search/backdoor app registration) | add credentials to a service principal (stealthy persistence) | dynamic group abuse | PRT theft for lateral movement
  GCP: service account token (metadata) | serviceAccountTokenCreator/actAs escalation | gcloud enumeration
🚨K8s deep dive (once cluster network/pod access is obtained): kubelet 10250 unauthenticated (/pods list, /exec into any container) | etcd 2379 without auth reads every secret | anonymous API Server | over-privileged SA in RBAC (kubectl auth can-i --list) | privileged pod host mount escape | steal the node identity in cloud K8s → IMDS
🚨MinIO attack matrix:
  Fingerprint: Server: MinIO | /minio/health/live → 200 (empty body) | /minio/health/cluster → 200 | 9000 (API) + 9001 (Console)
  Console brute force: POST http://IP:9001/api/v1/login body={"accessKey":"minioadmin","secretKey":"minioadmin"} | 403="invalid Login"
  STS API: POST /?Action=AssumeRoleWithWebIdentity&Version=2011-06-15&WebIdentityToken=JWT → needs a configured JWT provider
  CVE-2023-28432: POST /minio/health/cluster?verify (info leak, returns environment variables including MINIO_SECRET_KEY)
  CVE-2023-28434: path traversal /bucket/..%2F..%2Fetc/passwd → XMinioInvalidResourceName (unusable once patched)
  Anonymous access: GET /bucket-name/ → ListBucket (200) = anonymous read | PUT /bucket/file → AccessDenied (403) = anonymous write disabled
  Upload bypass: the app layer validates the sign but does not check the dir parameter → any bucket is writable (sign only covers cid+et+og, not dir)
  Extension bypass: .jsp;.jpg / .jsp%00.jpg slip past the app blacklist, but MinIO stores them as static files (image/jpeg) and never executes them
🚨Aliyun FC function (fcapp.run) enumeration:
  Identify: URL contains *.cn-{region}.fcapp.run → Aliyun Function Compute (serverless)
  Traits: POST returns "unauthorized method 'POST'" (405) = GET only | 200+{"code":200,"msg":"Forbidden"} = the path exists but parameters are missing
  Exploitation: GET /{path}/{id}.html → a 302 redirect leaks the real CDN domain + auth_key signed URL (exposes the CDN domain/bucket layout/signing algorithm)
  Enumeration: different path prefixes map to different apps (/mkzavakx/ vs /kpqwbcoq/) | invalid ID → 302 to qzone.qq.com/404.html (fallback)
  Path traversal: FC normalizes correctly (../ has no effect), but different function paths can be enumerated
  CDN auth_key (Kunlun CDN kunlunaq.com): format=timestamp-rand-uid-md5(uri-timestamp-rand-uid-privatekey) → cracking needs the privatekey | x-tengine-error exposes "denied by req auth"
  FC→CDN chain: the FC function generates the signed URL → download from the kunlun/kijwsks.com CDN | referer spoofed as Baidu (mo.baidu.com)
🚨ChengZi site builder (ChengZi SDK) decryption:
  Init: POST https://random.d3504.cn/init3 body={appkey,channelCode,...} → encrypted response (base64)
  Decrypt: single-byte XOR key=0x96 → JSON (channelCode/fu download URL/csu tracking URL/ph installer hash)
  d3504.cn sits behind Cloudflare + Aliyun DDoS protection (aliyunddos) + Kunlun CDN (kunlunaq.com) → multiple layers of defense
  Key: the fu field = the FC function URL for the real APK download (possibly a different region than the landing page!) | csu = click-tracking callback URL
```
