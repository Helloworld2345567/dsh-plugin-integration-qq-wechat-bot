# Bundled image client contract

This developer reference describes the bundled image worker. The worker and host are the source of truth for validation, limits and provider capability; model-facing instructions must use the short contract returned by the host.

## Connection and credentials

The host passes protocol, endpoint, workflow, model and credential binding as explicit worker arguments. Endpoints and credentials are validated before the request and never belong in personas, prompts, logs or generated skill files.

## Operations

Generation uses the provider's image generation operation. Reference editing uploads every selected input to the provider's edit operation. The host reports provider/model/workflow capabilities and the worker fails closed when a requested option is unsupported.

## Parameters and results

The host supplies the accepted parameter schema. Omit optional model, size, batch and format values unless the user requests them. The worker validates input signatures, output signatures, byte limits and returned counts, preserves completed outputs and emits stable error codes. It never silently replays a billed or uncertain request.

## Results and failures

Model invocation, output validation and platform delivery remain separate facts. A successful worker result does not prove visual correctness or platform delivery; use the actual returned count and delivery state.
