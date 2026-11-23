# Third-party licences

## shan-shui-inf (landscape generator)

The landscape is drawn by code from [shan-shui-inf](https://github.com/LingDong-/shan-shui-inf) by Lingdong Huang, vendored in `vendor/shan-shui-inf/` (upstream commit `9f754d2b2e73495db7883d4d4055a7b0903b0454`) and extracted into `src/shanshui/upstream.js`.

```
MIT License

Copyright (c) 2018 Lingdong Huang

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The Perlin noise inside it is adapted by upstream from [p5.js](https://github.com/processing/p5.js) (LGPL-2.1), as noted in upstream's source.

## Fonts

Bundled from the [Fontsource](https://fontsource.org) npm packages. Both are under the SIL Open Font License 1.1 (https://openfontlicense.org):

- **Cormorant Garamond** by Christian Thalmann (Catharsis Fonts). Used for the time.
- **EB Garamond** by Georg Duffner and Octavio Pardo. Used for the labels and settings.

## Sounds

`public/sounds/bowl.wav`, `qin.wav` and `bell.wav` are synthesised by `scripts/make-sounds.mjs` for this project (additive synthesis, no samples). They are released under **CC0 1.0** (public domain dedication).

## App icon

`src-tauri/icons/icon.svg` was drawn for this project. Same licence as the rest of the app.

## Libraries

Tauri, its plugins and the Rust crates they use are MIT and/or Apache-2.0 licensed. `rodio` (sound playback) is MIT/Apache-2.0. The npm packages (`@tauri-apps/*`, Vite, Vitest, ESLint, Puppeteer) are MIT or Apache-2.0. The full list is in `package-lock.json` and `src-tauri/Cargo.lock`.
