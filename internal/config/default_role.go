package config

// DefaultRoleName is the name of the built-in default role.
const DefaultRoleName = "Default"

// legacyDefaultRoleName is the name stored by earlier versions.
const legacyDefaultRoleName = "默认"

// IsDefaultRole reports whether name refers to the default role (current or legacy name).
func IsDefaultRole(name string) bool {
	return name == DefaultRoleName || name == legacyDefaultRoleName
}
