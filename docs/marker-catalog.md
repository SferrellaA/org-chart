# Marker Catalog

Leadership ranks can reference bundled marker IDs with:

```json
{ "type": "bundled", "id": "usaf-o5" }
```

The initial bundled catalog provides stable U.S. Air Force grade IDs and accessible labels:

- `usaf-e1` through `usaf-e9`
- `usaf-o1` through `usaf-o10`

The bundled SVG data is trusted package data and is rendered in a fixed-size marker box. The current artwork is neutral package SVG artwork keyed to Air Force grade IDs; replacing it with public-domain official insignia artwork can happen without changing author JSON.

Authors can also provide HTTPS images, text, or emoji markers:

```json
{ "type": "image", "url": "https://example.com/rank.svg", "alt": "Rank insignia" }
{ "type": "text", "text": "GS-15" }
{ "type": "emoji", "emoji": "★", "label": "star" }
```

Author-supplied inline SVG or HTML is not supported.
