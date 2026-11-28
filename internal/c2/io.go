package c2

import (
	"encoding/base64"
	"os"
)

// These thin wrappers exist to:
//   - Keep manager.go and handlers concise without repeated os imports;
//   - Make it easy to swap in an interface (e.g. internal/storage) for unit tests later.

func osMkdirAll(path string, perm os.FileMode) error {
	return os.MkdirAll(path, perm)
}

func osWriteFile(path string, data []byte, perm os.FileMode) error {
	return os.WriteFile(path, data, perm)
}

func base64Decode(s string) ([]byte, error) {
	return base64.StdEncoding.DecodeString(s)
}
