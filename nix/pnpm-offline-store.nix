# SPDX-License-Identifier: Apache-2.0
#
# Fixed-output offline dependency fetch for the pnpm workspace: `pnpm fetch`
# against the lockfile with the corepack-pinned pnpm, producing the offline
# store and the corepack pnpm provision the tarball derivation installs from.
{
  lib,
  stdenv,
  nodejs,
  cacert,
}:

{
  # Manifest-only workspace source: root manifests + lockfile + workspace
  # package manifests. Nothing else influences what `pnpm fetch` downloads.
  src,
}:

# When `pnpm-lock.yaml` or the `packageManager` pin changes, refresh this hash
# by building once and copying the `got: sha256-...` value Nix reports.
stdenv.mkDerivation {
  name = "pnpm-offline-store";
  inherit src;

  buildInputs = [ nodejs cacert ];

  outputHashMode = "recursive";
  outputHashAlgo = "sha256";
  outputHash = "sha256-faZ38YuBbXTnr6ldvY1K3ynmzorsC1vHb4C1QE/auHQ=";

  dontUnpack = true;
  dontConfigure = true;
  dontFixup = true;

  buildPhase = ''
    runHook preBuild

    workspace="$NIX_BUILD_TOP/workspace"
    mkdir -p "$workspace"
    cp -R "$src"/. "$workspace"/
    chmod -R u+w "$workspace"
    cd "$workspace"

    # Scratch HOME: anything pnpm/corepack writes outside the store stays out
    # of the fixed output.
    export HOME="$NIX_BUILD_TOP/home"
    mkdir -p "$HOME"

    export SSL_CERT_FILE="${cacert}/etc/ssl/certs/ca-bundle.crt"
    export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

    # Corepack provisions the pinned pnpm into COREPACK_HOME on first use;
    # inside this fixed-output derivation that download is allowed.
    export COREPACK_HOME="$out/corepack-home"
    mkdir -p "$COREPACK_HOME" "$out/pnpm-store"

    corepack pnpm fetch --store-dir "$out/pnpm-store"

    # pnpm stamps wall-clock `checkedAt` into the store index; zero them so the
    # fixed-output hash is reproducible across machines.
    find "$out/pnpm-store/v10/index" -type f -name '*.json' \
      -exec sed -i 's/"checkedAt":[0-9]*/"checkedAt":0/g' {} +

    runHook postBuild
  '';
}
