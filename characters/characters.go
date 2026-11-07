// Package characters is the roster of named on-screen characters an agent seat
// can wear: a display name, a family (Claude or Codex), a narration voice for the
// prompt and a palette from which its Minecraft skin is generated.
//
// roster.json is the single source of truth. It is embedded here for the Go CLI
// and read directly by the TypeScript runners (src/characters.ts). The PNGs in
// skins/ are generated from it; `go test ./characters -update` rewrites them.
package characters

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
)

//go:embed roster.json
var rosterJSON []byte

// Family is the model family a character belongs to. It fixes the harness that
// may wear it and the brand palette its skin and nametag use.
type Family struct {
	ID      string // roster value, e.g. "claude"
	Display string // shown after the name on screen, e.g. "Claude"
	Harness string // the only harness allowed to wear the character
}

var families = map[string]Family{
	"claude": {ID: "claude", Display: "Claude", Harness: "claude"},
	"codex":  {ID: "codex", Display: "Codex", Harness: "codex"},
}

// Palette holds the skin's colours as #rrggbb.
type Palette struct {
	Hair  string `json:"hair"`
	Skin  string `json:"skin"`
	Eyes  string `json:"eyes"`
	Light string `json:"light"`
	Shirt string `json:"shirt"`
	Trim  string `json:"trim"`
	Pants string `json:"pants"`
	Shoes string `json:"shoes"`
}

type Character struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Family    string  `json:"family"`
	Accent    string  `json:"accent"`
	Pattern   string  `json:"pattern"`
	HairStyle string  `json:"hair_style"`
	Sleeves   string  `json:"sleeves"`
	Palette   Palette `json:"palette"`
	Voice     string  `json:"voice"`
}

var (
	hexColour = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
	idPattern = regexp.MustCompile(`^[a-z][a-z0-9_]{0,15}$`)
	patterns  = map[string]bool{"sash": true, "bands": true, "zip": true, "chevron": true}
	hairs     = map[string]bool{"short": true, "long": true, "hood": true}
	sleeves   = map[string]bool{"short": true, "long": true}
)

// Roster parses and validates the embedded roster.
func Roster() ([]Character, error) { return parse(rosterJSON) }

func parse(b []byte) ([]Character, error) {
	var doc struct {
		Comment    string      `json:"$comment"`
		Characters []Character `json:"characters"`
	}
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if e := d.Decode(&doc); e != nil {
		return nil, fmt.Errorf("characters roster: %w", e)
	}
	seen := map[string]bool{}
	for _, c := range doc.Characters {
		if e := c.validate(); e != nil {
			return nil, fmt.Errorf("character %q: %w", c.ID, e)
		}
		if seen[c.ID] {
			return nil, fmt.Errorf("character %q listed twice", c.ID)
		}
		seen[c.ID] = true
	}
	return doc.Characters, nil
}

func (c Character) validate() error {
	if !idPattern.MatchString(c.ID) {
		return fmt.Errorf("id must be lowercase letters, digits or _, at most 16")
	}
	if c.Name == "" || c.Voice == "" {
		return fmt.Errorf("needs a name and a voice")
	}
	if _, ok := families[c.Family]; !ok {
		return fmt.Errorf("unknown family %q", c.Family)
	}
	if !patterns[c.Pattern] || !hairs[c.HairStyle] || !sleeves[c.Sleeves] {
		return fmt.Errorf("unknown pattern, hair_style or sleeves")
	}
	p := c.Palette
	for _, h := range []string{c.Accent, p.Hair, p.Skin, p.Eyes, p.Light, p.Shirt, p.Trim, p.Pants, p.Shoes} {
		if !hexColour.MatchString(h) {
			return fmt.Errorf("colour %q is not #rrggbb", h)
		}
	}
	return nil
}

// Lookup returns the roster character with this id.
func Lookup(id string) (Character, error) {
	all, e := Roster()
	if e != nil {
		return Character{}, e
	}
	ids := make([]string, len(all))
	for i, c := range all {
		if c.ID == id {
			return c, nil
		}
		ids[i] = c.ID
	}
	return Character{}, fmt.Errorf("unknown character %q (roster: %s)", id, strings.Join(ids, ", "))
}

// FamilyInfo describes the character's family.
func (c Character) FamilyInfo() Family { return families[c.Family] }

// Label is the on-screen nametag, e.g. "Ada · Claude".
func (c Character) Label() string { return c.Name + " · " + c.FamilyInfo().Display }

// Brief is the prompt section that tells the agent who it plays and how it sounds.
func (c Character) Brief() string { return "## Your character\n\n" + c.Voice + "\n" }

// SkinPath is the committed skin PNG inside a repository checkout.
func (c Character) SkinPath(root string) string {
	return filepath.Join(root, "characters", "skins", c.ID+".png")
}

// CastMember is what the recorder needs to dress one Minecraft player.
type CastMember struct {
	Character string `json:"character"`
	Name      string `json:"name"`
	Family    string `json:"family"`
	Label     string `json:"label"`
	Accent    string `json:"accent"`
	Skin      string `json:"skin"`
}

// Cast is keyed by Minecraft username and passed to every seat's recorder as
// EMERGENCE_CAST, so each camera can dress its own player and everyone it sees.
type Cast map[string]CastMember

func (c Character) Member(root string) CastMember {
	return CastMember{Character: c.ID, Name: c.Name, Family: c.FamilyInfo().Display, Label: c.Label(), Accent: c.Accent, Skin: c.SkinPath(root)}
}

func (c Cast) JSON() (string, error) {
	b, e := json.Marshal(c)
	return string(b), e
}
