# Community audit — review submission template

Use this template when posting a finding in the
[community audit discussion](https://github.com/LemonScripter/biowallet/discussions/3).

It keeps the public thread focused on **threat-model and proof-level questions**
(model gaps, invariant coverage, parameterization) without accidentally turning
the discussion into a live exploit writeup.

> [!IMPORTANT]
> If your finding is a **working bypass, key-exposure, or any concrete exploit
> repro**, do **not** post it here. Use
> [private vulnerability reporting](https://github.com/LemonScripter/biowallet/security/advisories/new)
> instead. See [SECURITY.md](../SECURITY.md) for scope, email, and disclosure timelines.

---

## Submission format

Copy the block below into your comment and fill it in:

```markdown
**Component:** <DCC chain / fuzzy extractor / SSS / vault / worker>

**Expected invariant:** <what the spec / Z3 model guarantees>

**Observed counterexample:** <the state transition or input the implementation allows>

**Affected file / commit:** `src/...` @ <commit sha or tag>

**Disclosure-safe?:** <yes — model gap, no working bypass / no — routing to private reporting>
```

### Field guide

| Field | What to write |
|---|---|
| **Component** | Which subsystem the finding touches — DCC causal chain, BCH fuzzy extractor, Shamir SSS, vault cryptography, or worker isolation. |
| **Expected invariant** | The property the spec or the Z3 model is supposed to guarantee (e.g. "a SIGN token is single-use and vault-bound"). |
| **Observed counterexample** | The state transition, edge case, or input the implementation appears to allow but the model does not cover. Describe the *gap*, not a step-by-step exploit. |
| **Affected file / commit** | Link or path to the relevant file plus the commit SHA or release tag you reviewed, so the finding is reproducible against a fixed version. |
| **Disclosure-safe?** | `yes` if it is a model/spec gap with no working bypass — safe to discuss publicly. `no` if it constitutes a real bypass or key exposure — stop and use private reporting. |

---

## Scope reminder

The following are **documented limitations**, not in scope for this review
(see [THREAT_MODEL.md](../THREAT_MODEL.md)):

- No liveness / PAD detection (attacker T7)
- PBKDF2 instead of Argon2id (WebCrypto has no native Argon2id)
- No external professional audit yet — this process is a step toward one
