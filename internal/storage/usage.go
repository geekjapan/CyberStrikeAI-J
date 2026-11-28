package storage

// Filesystem describes the capacity of the filesystem where a path resides.
type Filesystem struct {
	Path        string  `json:"path"`
	TotalBytes  int64   `json:"total_bytes"`
	FreeBytes   int64   `json:"free_bytes"`
	UsedBytes   int64   `json:"used_bytes"`
	UsedPercent float64 `json:"used_percent"`
	InodesTotal int64   `json:"inodes_total"`
	InodesFree  int64   `json:"inodes_free"`
	// Available false means the current platform does not support the query; the frontend should hide the capacity card rather than show 0.
	Available bool `json:"available"`
}

// FilesystemUsage returns the capacity information of the filesystem where path resides.
func FilesystemUsage(path string) (Filesystem, error) {
	return filesystemUsage(path)
}
