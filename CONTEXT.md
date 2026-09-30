# midnight-vc-passport

The digital-passport verifiable-credential family package and the release train that distributes it to npmjs.

## Language

### Release train

**Channel**:
The kind of release being cut — `snapshot`, `rc`, or `release` — which fixes the allowed branch, the version shape, and the dist-tag.
_Avoid_: Release type, stage

**Dist-tag**:
The npm registry label (`snapshot`, `rc`, `latest`) that a channel's version is published under.
_Avoid_: Tag (ambiguous with a git tag), npm tag

### Publication outcome

**Rejected**:
The publication attempt did not happen, or `npm publish` did not report success; nothing is claimed to exist on the registry.
_Avoid_: Failed publish (ambiguous with a verification failure)

**Accepted**:
`npm publish` reported success — the registry's claim, not yet observed evidence that the version is served.
_Avoid_: Published, succeeded

**Visible**:
The registry serves the exact version, with the packed tarball's integrity, under the channel's dist-tag.
_Avoid_: Propagated, live, available

**Verified**:
Visible, with `latest` unchanged for a non-`release` channel, and a clean consumer installed and exercised the version from the registry. The only outcome a green publication run may report.
_Avoid_: Done, fully published

**Published**:
Synonym for Verified; never used for Accepted.
_Avoid_: Using it for any state short of Verified
