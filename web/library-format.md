# Skipture library format

Skipture hands you a zip of empty sprite slots. You fill them in and send the zip back. This page says exactly what goes in the zip.

## The short version

1. Unzip the file you were sent. It has a `schema.json` and a `sprites/` folder of blank PNGs.
2. Replace each `sprites/<slot>.png` with your art. Keep the file name and the pixel size exactly as they are.
3. Zip it back up, with `schema.json` and the `sprites/` folder at the **top level** of the zip (not inside another folder).
4. Send the zip back.

Do not edit `schema.json`. It is what Skipture uses to match your files to slots.

## Starter schema

If you are describing a library from scratch rather than filling in a zip you were sent, start from this. Save it as `schema.json` (delete the two example slots and list your own), then either drop it on the site's Import page to create the library with every slot waiting for art, or put it in a zip with your PNGs as described below.

```json
{
  "format": "skipture-library",
  "version": 1,
  "library": {
    "slug": "my-library",
    "name": "My library",
    "app": "My app",
    "description": "What this library is for."
  },
  "sprites": [
    {
      "slot": "example-sprite",
      "name": "Example sprite",
      "kind": "sprite",
      "width": 16,
      "height": 16,
      "tile": false,
      "background": "transparent",
      "background_color": null,
      "category": "",
      "notes": "Delete this entry and list your own slots."
    },
    {
      "slot": "example-texture",
      "name": "Example texture",
      "kind": "texture",
      "width": 32,
      "height": 32,
      "tile": true,
      "background": "opaque",
      "background_color": "#336633",
      "category": "ground",
      "notes": "Opaque slots need a background colour."
    }
  ]
}
```

JSON has no comments, so everything that explains these fields is in this document. Skipture ignores any extra top-level fields you add, so you may add your own notes under a name like `"_notes"`.

Everything you draw is a starting point: the artist will redraw it by hand before it ships.

## What is in the zip

```
my-library.zip
├── schema.json            describes the library and every slot
├── README.txt             optional, ignored on import
└── sprites/
    ├── frog-0.png         one PNG per slot, named <slot>.png
    ├── frog-1.png
    └── ...
```

## schema.json

```json
{
  "format": "skipture-library",
  "version": 1,
  "purpose": "schema",
  "generated_at": "2026-10-12T20:15:00Z",
  "library": {
    "slug": "tadpole-frogs",
    "name": "Tadpole growth stages",
    "app": "Tadpole",
    "description": "The tadpole growing into a frog."
  },
  "sprites": [
    {
      "slot": "frog-0",
      "name": "Tadpole",
      "kind": "sprite",
      "width": 16,
      "height": 16,
      "tile": false,
      "background": "transparent",
      "background_color": null,
      "category": "growth",
      "notes": "Draw the green one; the app recolours it."
    }
  ]
}
```

### Top level

| Field | Meaning |
|---|---|
| `format` | Always `"skipture-library"`. Anything else is rejected. |
| `version` | Always `1`. |
| `purpose` | `"schema"` for blank slots sent to you, `"library"` for art as it stands. Informational. |
| `generated_at` | When the file was made. Informational. |
| `library.slug` | The library's id. **Skipture matches your zip to a library by this.** Lowercase letters, digits and dashes. |
| `library.name`, `app`, `description` | Labels shown in the app. |
| `sprites` | The list of slots, up to 1,500. |

### Each slot

| Field | Meaning |
|---|---|
| `slot` | The slot id. It is also the file name: slot `frog-0` is `sprites/frog-0.png`. Lowercase letters, digits, `-`, `_` and `.`; starts with a letter or digit; up to 64 characters. |
| `name` | A readable name. |
| `kind` | `"sprite"` or `"texture"`. |
| `width`, `height` | The size in pixels, 1 to 512 each. **Your PNG must be exactly this size.** |
| `tile` | `true` if the picture must repeat seamlessly (its left edge meets its right edge, top meets bottom). |
| `background` | `"transparent"` or `"opaque"`. |
| `background_color` | For opaque slots, the colour behind the picture as `#RRGGBB`. `null` for transparent ones. |
| `category` | A free label such as `icon` or `bust`. |
| `notes` | Instructions for you from the artist. Read these. |

A zip exported with `purpose: "library"` also has `state` and `humanized_at` on each slot, and `complete` and `humanized` at the top. You can ignore them.

## The PNGs

- One PNG per slot, named `<slot>.png`, inside `sprites/`.
- **The pixel size must match `width` × `height` exactly.** A picture of any other size is rejected for that slot, and the rest of the zip still imports.
- Draw at the native size. Do not draw large and shrink, and do not use anti-aliasing: one pixel in the file is one pixel in the app.
- **Transparent slots:** use a PNG with an alpha channel and leave the background fully transparent.
- **Opaque slots:** fill every pixel; no transparency.
- **Textures** marked `tile: true`: make the edges line up, since the app previews them tiled.
- Each PNG must be 2 MB or smaller.
- A slot with no PNG, or with a blank one, simply stays "waiting for art".

## Limits

- The whole zip: 16 MB.
- Up to 1,500 slots in a library.
- Zip must be a normal zip (stored or deflate). No password, no zip64, no nested zips.
- `schema.json` must be valid JSON, 5 MB or less.

## What happens when it is imported

- **If the library already exists** (same `library.slug`): your art goes into slots that are *empty* or still *as received*. Slots the artist has already redrawn or signed off are **kept as they are**, so your file never overwrites their work. Slots in your zip that the library does not have are ignored. A picture identical to what is already there is skipped.
- **If the library is new**, it is created with every slot in your schema.
- Problems are reported per slot (for example, "is 20x20 but the slot is 16x16") and do not stop the other slots from importing.
- Art you bring in lands as **as received**. Only the artist can mark a sprite redrawn or humanized.

## You can also send just a schema

A bare `schema.json` (no PNGs) is a valid import. It creates the library with all its slots waiting for art. That is a handy way to describe a library in a text editor. The site's Import page has a "Download blank schema" button with a template.

## Checklist before you send it

- [ ] `schema.json` and `sprites/` are at the top of the zip.
- [ ] Every PNG is named `<slot>.png` in lowercase.
- [ ] Every PNG is exactly the size in `schema.json`.
- [ ] Opaque slots are fully filled; transparent slots have a real alpha channel.
- [ ] Tiling textures tile.
- [ ] You read the `notes`.
