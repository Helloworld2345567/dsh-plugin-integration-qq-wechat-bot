# Panel UI design and extension guidelines

English | [简体中文](../ui-design-guidelines.md)

These guidelines apply to this plugin's panel refactoring and future extensions. The goal is to retain existing settings and capabilities, keep the interface concise, follow DSH usage conventions, and make similar operations consistent.

## 1. Scope and sources

- Current source code is authoritative for configuration fields, defaults, permissions, and persistence. The prototype is a reference for layout and interaction only.
- Do not add backend fields because a control appears in the prototype, or remove existing capabilities because the prototype omits them.
- Do not add settings absent from the current panel, such as temperature, reply style, persona usage tags, persona descriptions, arbitrary reference-file management, or workspace retention days.
- Retain existing entry points for supported model reasoning effort, ASR, video understanding, TTS, STS, music, permissions, storage management, and proactive messages. Show them when applicable; simplicity must not remove functionality.
- Do not copy example model directories, simulated authorization, invented statistics, in-memory saving, or mock service states from the prototype into production.

Primary sources:

| Area | Actual source |
| --- | --- |
| Fields and semantics | [Configuration reference](configuration.md), [types and schemas](../../src/core/types.ts) |
| Bot models, behavior, and media | [Bot settings](../../src/client/bot-settings-panel.ts), [voice selection](../../src/client/voice-models.ts) |
| Service configuration | [Services panel](../../src/client/services-panel.ts), [image configuration](../../src/core/image-service-config.ts) |
| Personas and files | [Persona panel](../../src/client/persona-panel.ts), [panel entry point](../../src/client/index.ts) |
| Automation | [Automation panel](../../src/client/automation.ts), [automation core](../../src/core/automation.ts) |
| Directories, files, and workspaces | [Directory picker](../../src/harness/pick-directory.ts), [file picker](../../src/harness/pick-file.ts), [storage panel](../../src/client/workspace-storage-panel.ts) |

The local review prototype lives in `.codex/panel-ui-demo/` and is not a release dependency. Where the prototype conflicts with these guidelines, follow these guidelines and the actual configuration.

## 2. Visual design and page structure

- Retain the review prototype's green accent and light background direction while supporting DSH's light and dark themes. Prefer existing `--dsw-*` semantic variables. Use green only for primary actions, selection, and status; do not override the host's global palette.
- Use the host's React instance, settings entry point, and system fonts. Do not create a second application shell, branding area, or independent theme switch.
- Follow DSH control sizing: navigation about 188px wide, navigation items 40px high, and content spacing 24px. Main headings use 20px/28px at weight 500; body text uses 14px/22px, with necessary supporting text at 12px/18px.
- Buttons are about 36px high. Use 12px corner radii for buttons and inputs, 16px for content containers, and 28px for dialogs. Increase touch targets where appropriate; do not compress information with tiny text.
- Keep clear entry points for Overview, Bots, Personas, Services, and Automation. Overview shows only real states, counts, items needing attention, and recent activity, without a service summary or quick actions. Manage service configuration in Services.
- Use compact lists and details for bots and personas. Keep creation actions in the toolbar. Names, channels, and IDs must distinguish entities with the same name.
- Use a list and details for services, keeping configuration, runtime state, and actions in the same context. Distinguish unknown, unconfigured, available, and failed states.
- Switch to a single column or horizontal section navigation in narrow containers. Respond to the plugin container's width, avoiding three simultaneous fixed sidebars for host navigation, plugin navigation, and the entity list.

## 3. Copy

- Show only headings, field labels, current values, states, and actions by default.
- Do not add decorative English headings, promotional copy, page introductions, repeated “takes effect next turn” messages, or small text explaining implementation details.
- Keep short hints only when they affect a user decision: input range or format, why an action is disabled, the next step after an error, or deletion scope. Explain when saved changes take effect once in a central location.
- Use consistent action verbs: Save, Undo, Create, Select directory, Select file, Open directory, Refresh, Start, Stop, and Delete.
- Keep success feedback short; do not stack several messages for the same event. Show errors near the relevant action and associate field errors with their inputs. Do not expose raw exceptions or internal identifiers as ordinary user copy.
- Confirm session deletion in a compact, centered window with a short title and separate description. Wrap long session IDs without filling the screen. Include attachments in the deletion scope and explain that attachments still used by other sessions remain.
- Maintain Chinese and English together. The UI follows the host language without changing bot message language or drafts.

## 4. Shared operation contracts

Consistency applies to action meaning, submission timing, and loading, cancellation, and error behavior. It does not mean every button must use the same dialog.

| Operation | Result of clicking | Submission and cancellation |
| --- | --- | --- |
| Select directory | All directory fields call the same native directory-picker entry point and fill the corresponding field on success | Update only the draft. Cancellation preserves the original value. Do not open File Explorer, save, or start a service |
| Select file | Open the system file picker and accept only JSON workflow files | Share loading, cancellation, errors, and field updates with directory selection; update only the draft |
| Open directory | Use the existing host capability to open the actual directory | Immediate action; do not change fields or mark the draft dirty |
| Select provider/model/service/voice | Use consistent controls for similar selectors. Prefer native select controls for finite options; use selection dialogs only for complex catalogs | Change only the corresponding draft. Do not automatically save, start, authorize, probe, or preview audio |
| Refresh list | Reload existing model, Service Profile, or library-scan results | Preserve drafts and do not require unrelated changes to be saved first. Clearly show an invalid selection without automatically choosing another |
| Check connection | Call the service's existing health-query capability | Check saved configuration. Do not equate a configured directory with a connected service or add probe APIs solely for display |
| Save | Validate and submit the current editing scope | Prevent duplicate submissions while saving. Preserve the draft on failure and update the baseline on success |
| Undo | Restore the saved baseline for the current editing scope | Do not refetch old data that could overwrite later edits. Confirm only once when confirmation is needed |
| Start/Stop/Reconnect/Authorize | Call the existing action for the current object | Execute immediately and lock only related operations. Do not present an already-running service as being “restarted” |
| Delete/Clean up/Apply file | Identify the object and irreversible effects before execution | Use one confirmation. Retain existing cleanup previews, ownership rules, and protections |

### Directory and file selection

- Use the current path only as an initial location supported by the existing capability. Do not introduce new configuration or compatibility layers because a native picker cannot open a specific location.
- On Windows, directory and file selection share a topmost owner window and cancellation mechanism; release both on close or cancellation. Directory selection on other platforms retains the host capability. If native file selection is unavailable, report that it is unsupported and keep manual path entry available.
- Show “Selecting…” and a cancellation action while selecting, locking only that selection action. Unrelated fields remain editable.
- After page or object changes, cancellation, or unmounting, late selection results must not populate a different object.
- Show a short failure reason and retry action near the field. User cancellation is not an error.
- Clear the field's previous picker error when editing its path, restoring its default, or undoing changes. Saving a scope ends its pending selection and ignores late results.
- Follow the same flow for workspace directories, model libraries, and service roots. File selection and opening a directory retain their distinct meanings.
- Use the system file picker for workflow files and limit it to supported JSON files; use “Open directory” for opening the system file manager. Do not add directory creation, uploads, or general file management.

### Service and model selection

- Selecting a service in the left list only browses its configuration. Selecting a service in bot settings changes configuration. Keep these actions distinct.
- Providers and models come from the host catalog. When the model changes, reset incompatible reasoning effort using existing rules. Do not hard-code example models.
- Voice and STS selection retain existing `serviceId/profileId`, capability, and readiness rules. Keep necessary tool/skill synchronization without adding persistence fields.
- A TTS engine change clears only incompatible fields. Voices from different engines must not be mixed. ASR and video retain their existing relationship with the main model.
- A selection from a small list completes the selection step and is then saved on the page. A dialog selection fills the draft after confirmation and is likewise saved on the page; do not chain multiple confirmation dialogs.
- Unsaved service configuration must not silently be used to start a service. Offer one “Save and start” action; do not start if saving fails. Drafts for other services must not lock unrelated actions.
- Retain necessary existing dependencies: after selecting a Breeze project directory, fill the default voices directory only if it is empty. Saving services may trigger background model discovery. Health queries on page load, explicit refresh, and after starting a service continue to follow existing contracts.

## 5. Drafts, saving, and feedback

- Maintain `baseline / draft / pending / error` by editing object and actual backend save boundary. Restoring the original value clears dirty state; do not introduce hashes.
- Each editing scope has one save entry point. Avoid two unlabeled “Save” actions on the same page. Separate submission scopes, such as workspace and bot settings, must be displayed separately or clearly named. Do not present multiple requests as an atomic save.
- Ordinary configuration follows select/edit, then save. Commands such as start/stop, authorization, and trust revocation retain immediate execution semantics. Revoked permissions are still rechecked at execution time.
- Switching personas preserves history and takes effect from the next turn after saving. In-flight tasks continue using their frozen configuration. Refactoring must preserve these constraints.
- Leaving a page or object with drafts offers Save and continue, Discard changes, and Continue editing. Creation and credential forms receive the same protection. Credentials remain only in current memory and the existing credentials service.
- If editing remains available while saving, merging the response must not overwrite input entered after submission. Otherwise freeze only the current editing scope. Discard late asynchronous results based on request/object identity.
- A refresh failure after a successful write must be reported as a refresh failure, not a failed save, and must not cause resubmission.
- Handle initial loading, empty lists, load failures, and background refresh separately. Provide local retry after a load failure and retain existing data when a refresh fails.

## 6. Configuration scope

| Page | Existing configuration/capabilities that may be shown | Do not add |
| --- | --- | --- |
| Model and replies | Provider, model, reasoning effort when supported, delayed-processing replies and their interval | Temperature, reply style, persona override settings |
| Media | Existing image protocol, ASR protocol, video understanding, TTS engine/voice/reply mode, STS, music, and related settings | New protocols, new parameters, client-defined model paths |
| Persona | ID, name, persona prompt, and existing open/apply/import actions for `persona.md` and `config.json` | Tags, descriptions, an arbitrary reference-file editor |
| Services | Existing voice-service addresses and directories, Breeze voices directory, image-service fields, ComfyUI address/workflow, RVC directory, and music-source order | ComfyUI project directory, an independent ComfyUI model selector, a single music source replacing the ordered array |
| Workspace | Current directory, storage statistics, filters, cleanup preview, retention markers, and related capabilities | Nonexistent policies such as a fixed “retain for 30 days” setting |
| Automation | Current persona/private session, existing proactive-message settings, scheduled-task content, execution time, timezone, enable/disable/delete, and other existing actions | Task-name fields, weekday/weekly selectors, task editing without a corresponding API |

This table limits additions; it is not a list of existing settings to remove. Before implementation, map actual fields and submission actions to pages. Retain capabilities already present in configuration but absent from the prototype.

## 7. Components and extensions

- Keep host integration, page switching, and necessary coordination in `src/client/index.ts`. Group queries, drafts, and actions by page. Reuse existing `ui.ts` and `layout.ts`, extracting shared components only when real duplication appears.
- Prioritize consistent form fields, selectors, save bars, status feedback, native dialogs, and asynchronous selection actions. Do not build a general workflow framework or a second state model.
- Use `<dialog>.showModal()` for confirmation, form, and other in-page modal dialogs. Preserve Escape, cancellation, focus restoration, and unsaved-change protection. Do not add a handwritten focus trap.
- Use native form/label/input/select elements and support Enter to submit. On submission failure, focus the first error. Do not show fields as invalid on initial display.
- Scope styles to the plugin root. Continue using container queries, visible focus, and reduced-motion preferences. Centralize host adaptation rather than spreading selectors that depend on the host DOM hierarchy.
- New entry points must identify their existing schema/catalog/API basis and reuse the corresponding operation contract. New backend capabilities require a separate, explicit request; they must not be incidental additions to a visual refresh.

For web-platform implementation, refer to [Modern Web Guidance](https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/SKILL.md) and use only rules relevant to the current change. The user's scope and simplicity requirements take precedence.

## 8. Implementation order and acceptance

1. Read these guidelines, existing source code, and worktree state; preserve changes from other tasks. First map existing fields and actions instead of copying the prototype's simulated implementation.
2. Unify directory/file/service selection, forms, dialogs, and save feedback before adjusting page layout and concise copy.
3. Fix currently reachable draft-overwrite, leave-protection, loading, and local pending-state issues. Preserve effective revision, cancellation, and concurrency protections.
4. Update Chinese and English resources and relevant tests. Run the type checks, tests, build, and documentation checks required for UI changes in the [development guide](development.md).
5. Verify in a real browser: directory-selection success, cancellation, and late results; model and service selection changing only drafts; refresh preserving drafts; save failure and refresh failure after a successful save; page-leave protection; keyboard use; light/dark themes; and narrow host containers.

Before each check, state the specific failure it is intended to prevent. Do not repeat the same check after it passes. The prototype and fake React tests do not prove that native pickers, focus, or real host layout work correctly. Clearly record host behavior that could not be verified.

This plan authorizes implementation and local verification. Pushing, publishing, installing into a running instance, restarting real services, or sending platform messages still requires explicit user authorization.
