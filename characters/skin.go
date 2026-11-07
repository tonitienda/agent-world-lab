package characters

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"strconv"
)

// A Minecraft 64×64 skin unwraps each box (w wide, h tall, d deep) from its UV
// origin (u, v) as: top and bottom in the first d rows, then right, front,
// left and back side by side. Overlay boxes (hat, jacket, sleeves, pants) use
// the same unwrap from their own origin and stay transparent except the hood.
type box struct{ u, v, w, h, d int }

var (
	head     = box{0, 0, 8, 8, 8}
	hat      = box{32, 0, 8, 8, 8}
	body     = box{16, 16, 8, 12, 4}
	rightArm = box{40, 16, 4, 12, 4}
	leftArm  = box{32, 48, 4, 12, 4}
	rightLeg = box{0, 16, 4, 12, 4}
	leftLeg  = box{16, 48, 4, 12, 4}
)

type face int

const (
	top face = iota
	bottom
	right
	front
	left
	back
)

// paint fills every face of b; fn gets the face, the face's width and height and
// a pixel with y=0 at the top of the face (the back of the head for top/bottom).
func (b box) paint(img *image.NRGBA, fn func(f face, w, h, x, y int) color.Color) {
	rects := []struct {
		f            face
		x0, y0, w, h int
	}{
		{top, b.u + b.d, b.v, b.w, b.d},
		{bottom, b.u + b.d + b.w, b.v, b.w, b.d},
		{right, b.u, b.v + b.d, b.d, b.h},
		{front, b.u + b.d, b.v + b.d, b.w, b.h},
		{left, b.u + b.d + b.w, b.v + b.d, b.d, b.h},
		{back, b.u + 2*b.d + b.w, b.v + b.d, b.w, b.h},
	}
	for _, r := range rects {
		for y := 0; y < r.h; y++ {
			for x := 0; x < r.w; x++ {
				if c := fn(r.f, r.w, r.h, x, y); c != nil {
					img.Set(r.x0+x, r.y0+y, c)
				}
			}
		}
	}
}

func rgb(h string) color.NRGBA {
	n, _ := strconv.ParseUint(h[1:], 16, 32)
	return color.NRGBA{uint8(n >> 16), uint8(n >> 8), uint8(n), 255}
}

// shade darkens (amount < 0) or lightens a colour; used only for small details
// such as the mouth, so every large area stays an exact palette colour.
func shade(c color.NRGBA, amount float64) color.NRGBA {
	f := func(v uint8) uint8 {
		x := float64(v)
		if amount < 0 {
			x *= 1 + amount
		} else {
			x += (255 - x) * amount
		}
		return uint8(x + 0.5)
	}
	return color.NRGBA{f(c.R), f(c.G), f(c.B), 255}
}

// Skin renders the character's original 64×64 skin: colour blocking and one
// simple torso pattern, no logos or lettering.
func (c Character) Skin() *image.NRGBA {
	p := c.Palette
	hair, skin, eyes, light := rgb(p.Hair), rgb(p.Skin), rgb(p.Eyes), rgb(p.Light)
	shirt, trim, pants, shoes := rgb(p.Shirt), rgb(p.Trim), rgb(p.Pants), rgb(p.Shoes)
	img := image.NewNRGBA(image.Rect(0, 0, 64, 64))

	head.paint(img, func(f face, w, h, x, y int) color.Color {
		switch f {
		case top:
			return hair
		case bottom:
			return skin
		case front:
			if c.HairStyle == "hood" {
				// The hood frames the face; the overlay below adds its rim.
				if y < 2 || x == 0 || x == w-1 {
					return hair
				}
			} else if y < 2 || (c.HairStyle == "long" && (x == 0 || x == w-1) && y < 7) {
				return hair
			}
			switch {
			case y == 4 && (x == 1 || x == 6):
				return light
			case y == 4 && (x == 2 || x == 5):
				return eyes
			case y == 6 && (x == 3 || x == 4):
				return shade(skin, -0.25)
			}
			return skin
		case back:
			if c.HairStyle == "short" && y >= 6 {
				return skin
			}
			return hair
		default: // sides: hair over the top and toward the back of the head
			// Right face: x=0 is the back of the head; left face: x=0 is the front.
			fromFront := w - 1 - x
			if f == left {
				fromFront = x
			}
			limit := 3
			if c.HairStyle == "long" || c.HairStyle == "hood" {
				limit = 7
			}
			if y < 2 || (y < limit && fromFront >= 3) {
				return hair
			}
			if y == 7 && fromFront >= 6 && c.HairStyle == "long" {
				return hair
			}
			return skin
		}
	})
	if c.HairStyle == "hood" {
		hat.paint(img, func(f face, w, h, x, y int) color.Color {
			switch f {
			case top, back:
				return shirt
			case right, left:
				if y < 7 {
					return shirt
				}
			case front:
				if y == 0 {
					return trim
				}
			}
			return nil
		})
	}

	body.paint(img, func(f face, w, h, x, y int) color.Color {
		if f == top || f == bottom {
			return shirt
		}
		if y == h-1 {
			return trim // belt / hem
		}
		if f != front && f != back {
			return shirt
		}
		switch c.Pattern {
		case "sash": // shoulder to hip, front and back
			d := x - y*w/h
			if f == back {
				d = (w - 1 - x) - y*w/h
			}
			if d == 0 || d == 1 {
				return trim
			}
		case "bands":
			if y == 3 || y == 4 || y == 8 {
				return trim
			}
		case "zip":
			if f == front && (x == 3 || x == 4) {
				return trim
			}
			if f == front && y == 7 && (x == 1 || x == 6) {
				return trim // pocket seam
			}
		case "chevron":
			dx := x - 3
			if x >= 4 {
				dx = 4 - x
			}
			if y == 3-dx || y == 4-dx {
				return trim
			}
		}
		if f == front && y == 0 && (x == 3 || x == 4) {
			return skin // open collar
		}
		return shirt
	})

	arm := func(f face, w, h, x, y int) color.Color {
		cuff := 4
		if c.Sleeves == "long" {
			cuff = 10
		}
		switch {
		case f == top:
			return shirt
		case f == bottom:
			return skin
		case y < cuff:
			return shirt
		case y == cuff:
			return trim
		}
		return skin
	}
	rightArm.paint(img, arm)
	leftArm.paint(img, arm)

	leg := func(f face, w, h, x, y int) color.Color {
		switch {
		case f == top:
			return pants
		case f == bottom || y >= 10:
			return shoes
		}
		return pants
	}
	rightLeg.paint(img, leg)
	leftLeg.paint(img, leg)
	return img
}

// SkinPNG encodes Skin as PNG bytes.
func (c Character) SkinPNG() ([]byte, error) {
	var b bytes.Buffer
	e := png.Encode(&b, c.Skin())
	return b.Bytes(), e
}
