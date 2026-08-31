# Encoding Functions

Sprig has the following encoding and decoding functions:

- `b64enc`/`b64dec`: Encode or decode with Base64
- `b32enc`/`b32dec`: Encode or decode with Base32

## genCA

Generate a certificate authority. The returned object has these fields:

- `Cert`: A PEM-encoded certificate
- `Key`: A PEM-encoded private key
