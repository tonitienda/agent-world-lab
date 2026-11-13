# The Agent Terrarium title cards

The [Claude Design title card system](https://claude.ai/artifact/CTaeMUkGJKfsnnqBahXN4H#page-dcb81aee8d83)
sets the visual reference. Use the dark specimen frame, the series mark at
top left, the mode at top right, and the game’s accent for labels and values.
Keep episode numbers in production metadata so cuts can be reordered.

Copy the opening and ending objects from [splash-segments.json](splash-segments.json)
into a v2 edit plan and replace the example facts with verified episode data.
The shared Motion Canvas scene renders the optional `titleCard` field. Set
the opening `background` to a valid initial camera and source time. The frame
appears in the right observation window at 30% opacity. Keep the premise to
one sentence and the title short enough to fit on one line. Use four concise
facts in the footer. Use Space Grotesk for copy and JetBrains Mono for labels
where available. Arial and Menlo are fallbacks.

| Mode | Accent | Setup |
| --- | --- | --- |
| Competitive | `#E8C36A` | Matchup facts |
| Arena | `#F08A4B` | Agent and opposing field |
| Tycoon | `#5FD3C4` | Targets and budget |
| Sandbox | `#8BD46A` | Exact short player prompt |
| Simulation | `#A99BF5` | Starting conditions |

Aim for **4–6 seconds** on the opening, then cut into gameplay. For longer
existing speech, keep the voice clip whole and move the excess into the
gameplay edit. New presenter copy can fit the opening from the start.

Use the ending as a **stable final 20-second hold**. Put the verified result,
up to three stats and the viewer prompt on the left. Place the presenter’s
thank-you near the start and leave music and a stable picture under the links.
The ending template uses a hard cut so the slots are ready for the full hold.
After export, place two video elements and a subscribe element in YouTube
Studio and align their start times to the beginning of the hold. YouTube
supports end screens in the final 5–20 seconds of an eligible video.
[YouTube end-screen help](https://support.google.com/youtube/answer/6388789)

Use [end-screen-guides.svg](end-screen-guides.svg) as a transparent preview
overlay. Coordinates are on a 1920 × 1080 reference canvas. At 4K, double them.
Verify placement in Studio because the controls may constrain element sizes
and positions. Export with the guide layer off. The rendered slots remain
plain panels when YouTube hides its overlays. Check the beginning and last
frame of the hold and confirm the chapter times after timing changes.
