package characters

import (
	"bytes"
	"flag"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

var update = flag.Bool("update", false, "rewrite skins/*.png from roster.json")

func TestRosterIsValidAndBranded(t *testing.T) {
	all, e := Roster()
	if e != nil {
		t.Fatal(e)
	}
	count := map[string]int{}
	for _, c := range all {
		count[c.Family]++
	}
	if count["claude"] < 2 || count["codex"] < 2 {
		t.Fatalf("want two characters per family, got %v", count)
	}
	// Every large area of a skin must come from the family's brand palette.
	brand := map[string]map[string]bool{
		"claude": set("#141413", "#faf9f5", "#b0aea5", "#e8e6dc", "#d97757", "#6a9bcc", "#788c5d"),
		"codex":  set("#000000", "#0f0f0f", "#ffffff", "#f1f1f1", "#10a37f", "#666666", "#8f8f8f"),
	}
	for _, c := range all {
		p := c.Palette
		for _, h := range []string{c.Accent, p.Hair, p.Eyes, p.Light, p.Shirt, p.Trim, p.Pants, p.Shoes} {
			if !brand[c.Family][h] {
				t.Errorf("%s: %s is outside the %s palette", c.ID, h, c.Family)
			}
		}
	}
}

func set(xs ...string) map[string]bool {
	m := map[string]bool{}
	for _, x := range xs {
		m[x] = true
	}
	return m
}

func TestLookup(t *testing.T) {
	c, e := Lookup("bram")
	if e != nil || c.FamilyInfo().Harness != "codex" || c.Label() != "Bram · Codex" {
		t.Fatalf("bram: %+v %v", c, e)
	}
	if _, e := Lookup("nobody"); e == nil {
		t.Fatal("unknown character accepted")
	}
}

func TestRejectsUnknownFieldsAndColours(t *testing.T) {
	if _, e := parse([]byte(`{"characters":[{"id":"x","colour":"red"}]}`)); e == nil {
		t.Fatal("typo field accepted")
	}
	bad := `{"characters":[{"id":"x","name":"X","family":"claude","accent":"orange","pattern":"sash","hair_style":"short","sleeves":"short","voice":"v","palette":{}}]}`
	if _, e := parse([]byte(bad)); e == nil {
		t.Fatal("bad colour accepted")
	}
}

// The committed skins are generated output; this keeps them in sync with the roster.
func TestSkinsMatchRoster(t *testing.T) {
	all, e := Roster()
	if e != nil {
		t.Fatal(e)
	}
	for _, c := range all {
		want, e := c.SkinPNG()
		if e != nil {
			t.Fatal(e)
		}
		path := filepath.Join("skins", c.ID+".png")
		if *update {
			if e := os.MkdirAll("skins", 0755); e != nil {
				t.Fatal(e)
			}
			if e := os.WriteFile(path, want, 0644); e != nil {
				t.Fatal(e)
			}
			continue
		}
		got, e := os.ReadFile(path)
		if e != nil || !bytes.Equal(got, want) {
			t.Fatalf("%s is stale or missing; run go test ./characters -update", path)
		}
		img, e := png.Decode(bytes.NewReader(got))
		if e != nil || img.Bounds().Dx() != 64 || img.Bounds().Dy() != 64 {
			t.Fatalf("%s is not a 64×64 PNG", path)
		}
		// Base-layer head front, torso front and both legs are fully opaque.
		for _, pt := range [][2]int{{12, 12}, {24, 26}, {6, 26}, {22, 58}, {44, 26}, {38, 58}} {
			if _, _, _, a := img.At(pt[0], pt[1]).RGBA(); a == 0 {
				t.Fatalf("%s: transparent base-layer pixel at %v", path, pt)
			}
		}
	}
}
