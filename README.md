# harmony 2

**Try it: https://rsk7.github.io/harmony2/**

A modular synthesizer in the browser. Drop modules on a page, patch them together with cables, and play.

This is a second take on [harmony](https://github.com/rsk7/harmony) (2015), which turned the computer keyboard into a two-octave Web Audio synth. harmony 2 keeps its look (pale grey panels, color only when something sounds) and its wavetables, but you build the synth yourself, one patch cable at a time.

## Using it

- **Add modules:** double-click the background, or use **+ add module**. Type to search.
- **Patch:** drag from an output jack (right side of a module) to an input jack (left side). Outputs can feed several inputs, and inputs sum everything plugged into them.
- **Remove:** click a cable or module, then press ⌫.
- **Play:** the **keyboard** module maps your computer keys like a piano (`a w s e d f t g y h u j k o l p ;`, with `z`/`x` to change octave). Oscillators, envelopes, the sampler and the drums can also be bound to a single key with **bind key**.
- **Knobs:** drag up/down or scroll. Hold shift for fine control, double-click to reset.
- **Collapse:** the chevron on each module (or double-clicking its title) switches between the full panel and a compact one with just the main controls. Jacks stay put.
- **Cables:** choose physics-simulated cables that swing and sag (with a stiff ↔ floppy slider), or straight right-angle wires. **Cables behind** greys them out and moves them under the modules.
- Your patch is saved in the browser automatically. **new patch** starts over.

Start from a preset in the add menu (**drum kit**, **synth voice**, **arp voice**) to hear something right away. Presets patch themselves into the speaker if there is one.

## Modules

| | |
|---|---|
| **sources** | oscillator, wavetable (harmony's piano/organ/wurlitzer/celesta/warmsaw tables), noise (white/pink/brown), sampler (drop in any audio file), microphone |
| **shaping** | filter (LP/HP/BP/notch), vca, mixer, waveshaper |
| **control** | envelope (ADSR), lfo, keyboard, sequencer (8 steps), arpeggiator, clock, random (sample & hold) |
| **drums** | kick, snare, hi-hat, clap, tom, beat grid (4 × 16 trigger sequencer) |
| **effects** | delay, reverb, chorus/flanger, compressor |
| **visual** | scope, spectrum, tuner |
| **utility** | speaker, multiple, attenuverter, recorder (saves .wav) |

### Signals

Every cable carries an audio-rate signal, so anything can modulate anything:

- **audio:** -1 to 1
- **pitch:** 1 unit per octave, 0 = C4. The keyboard, sequencer and arpeggiator output this, and oscillators and the sampler take it on their `pitch` input.
- **gate:** 0 or 1. A rising edge triggers envelopes, drums, the sampler and the step modules.
- **cv:** roughly -1 to 1, e.g. from the lfo, envelope or random module. The filter's `cut` input sweeps in octaves (scaled by its `mod` knob).

## Development

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
```

Built with Vite, React, TypeScript and [React Flow](https://reactflow.dev). The audio engine (`src/audio/`) is plain Web Audio with no framework. Anything that has to react to gates and clocks sample-accurately (envelope, clock, sequencer, arpeggiator, drum voices, beat grid, sample & hold, recorder) runs in an AudioWorklet (`src/audio/worklets/processors.ts`). Modules are declared in `src/modules/`, and each one lists its jacks, its knobs and how to build its audio nodes. The cable physics is a small Verlet rope simulation in `src/physics/rope.ts`.

Pushing to `main` deploys to GitHub Pages via `.github/workflows/deploy.yml`.
