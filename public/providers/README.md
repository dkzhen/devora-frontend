# Provider marks

The console shows a provider as an avatar, not as text. `provider` is a display
concern only — routing uses `upstream_model_id` — so nothing here affects requests.

## Adding a logo

Drop a file named after the provider value, lowercased, with any run of non-alphanumeric
characters replaced by a single hyphen:

| `provider` in the catalogue | filename to add        |
|-----------------------------|------------------------|
| `deepseek`                  | `deepseek.svg`         |
| `OpenRouter`                | `openrouter.svg`       |
| `Token Harbor`              | `token-harbor.svg`     |
| `Together.ai`               | `together-ai.svg`      |

Accepted formats: `.svg` (preferred), `.png`, `.webp` — but the filename extension is
fixed to `.svg` in the component, so **use SVG** or adjust `providerAsset()` in
`src/app/(protected)/console/admin/models/page.tsx`.

## Until a file exists

The table renders the provider's initial in a bordered square instead of a broken image.
That is the current state for every provider — no assets have been added yet.
