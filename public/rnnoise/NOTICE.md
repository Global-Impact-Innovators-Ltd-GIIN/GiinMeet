# Noise cleaning — third-party licences

GiinMeet's Noise Cleaning (Feature 17) runs entirely on the user's
own device. These files are the compiled RNNoise model and its
AudioWorklet processor, vendored so they are served with the app —
no CDN, no account, no per-minute charge, no audio leaving the
device.

## RNNoise — the model itself

- Project: https://github.com/xiph/rnnoise
- Licence: BSD 3-Clause
- Copyright (c) 2017 Mozilla, 2007-2017 Jean-Marc Valin,
  2005-2017 Xiph.Org Foundation, 2003-2004 Mark Borgerding
- The BSD 3-Clause licence permits redistribution and use in source
  and binary forms, with or without modification, provided the
  copyright notice, the list of conditions and the disclaimer are
  retained. It is free for commercial use.

Files: `rnnoise.wasm`, `rnnoise_simd.wasm`

## @shiguredo/rnnoise-wasm — the WebAssembly build of RNNoise

- Project: https://github.com/shiguredo/rnnoise-wasm
- Licence: Apache License 2.0
- Copyright 2021-2025 Takeru Ohta (original author),
  Copyright 2021-2025 Shiguredo Inc.

## @sapphi-red/web-noise-suppressor — the loader + worklet wrapper

- Project: https://github.com/sapphi-red/web-noise-suppressor
- Licence: MIT
- Copyright (c) 2022 green
- The package is also a runtime dependency (see package.json); its
  `loadRnnoise` picks the SIMD model when the browser supports it,
  and its `RnnoiseWorkletNode` feeds the model the microphone audio.

File: `rnnoiseWorklet.js` (the bundled AudioWorklet processor from
`@sapphi-red/web-noise-suppressor@0.4.2`, `dist/rnnoise/workletProcessor.js`)

## What this means for GiinMeet

Noise Cleaning is free forever: no vendor, no key, no usage-based
billing. The only paid routes that were NOT used — Krisp (free plan
retired November 2026; $8/user/month billed annually) and LiveKit
Cloud voice isolation ($0.0012/min after included minutes) — are
deliberately avoided. If these vendored files are ever replaced,
keep this notice in step with them.
