# The valley's baked data

`public_static/valley/` holds the parts of the wallpaper landscape that never change: the land's height field,
the tree and shrub shapes, and where every tree stands. They come from `scene10.py` (the preview renderer the
look was designed in) via:

    pip install numpy pillow
    cd scripts/valley && python3 export_valley.py ../../public_static/valley

Everything that changes — light, season, weather, constellations, the motto — is drawn in the app (`src/valley`).
