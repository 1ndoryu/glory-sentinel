# Stage manifest contract

`sentinel check --stages <path>` accepts the versioned envelope below:

```json
{
  "schemaVersion": 1,
  "stages": [
    {
      "name": "frontend",
      "executable": "node",
      "args": ["scripts/check.mjs", "{reportPath}"],
      "reportPath": "frontend.json",
      "expectedSchemaVersion": "1",
      "timeoutMs": 120000,
      "cwd": "."
    }
  ]
}
```

During the migration window, a legacy raw array containing the stage objects is also accepted and normalized to schema version `1`. Empty stage lists remain valid for compatibility. Envelope and stage objects reject unknown keys, invalid types, duplicate stage names, invalid timeouts, and traversal.

`reportRoot` must be physically contained by the workspace. Relative `reportPath` values resolve below `reportRoot`; `cwd` resolves below the workspace and must be an existing directory. The manifest must be a regular non-symlink file. Report directories are created one segment at a time and checked before and after creation so symlink/junction escapes fail closed. A stage must exit with code `0` and produce a valid report; a non-zero exit is a `tool-error` even if a JSON report exists.

Project-specific commands remain in the project adapter. Sentinel owns process status, containment, stage scheduling, and report normalization. Rollback is to keep the previous Sentinel release and the consumer adapter unchanged until a published commit has passed a clean-clone build and the consumer gate.
