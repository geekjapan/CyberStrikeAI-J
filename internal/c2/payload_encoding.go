package c2

import (
	"encoding/base64"
	"encoding/binary"
)

// b64StdEncode encodes a string using standard base64.
func b64StdEncode(s string) string {
	return base64.StdEncoding.EncodeToString([]byte(s))
}

// utf16LEBase64 encodes a string as UTF-16LE and then base64 for PowerShell -EncodedCommand
// (accepted by Windows PowerShell to avoid command-line escaping pitfalls).
func utf16LEBase64(s string) string {
	runes := []rune(s)
	buf := make([]byte, 0, len(runes)*2)
	for _, r := range runes {
		// Note: runes > 0xFFFF require surrogate pairs, though PowerShell commands stay within the BMP.
		var enc [2]byte
		binary.LittleEndian.PutUint16(enc[:], uint16(r))
		buf = append(buf, enc[:]...)
	}
	return base64.StdEncoding.EncodeToString(buf)
}
