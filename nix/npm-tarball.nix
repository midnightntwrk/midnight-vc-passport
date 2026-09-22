# SPDX-License-Identifier: Apache-2.0
#
# Per-publishable-package npm tarball: offline `pnpm install` from the fixed-
# output store, then the real `prepack` pipeline via `pnpm pack`.
{
  lib,
  stdenv,
  nodejs,
  compact-midnight,
  compact-toolchain,
  midnight-circuit-params,
  src,
  offlineStore,
  pkg,
}:

stdenv.mkDerivation {
  pname = "npm-tarball-${pkg.baseName}";
  version = pkg.version;

  inherit src;

  # The `compact` devtool locates the compiler through COMPACT_DIRECTORY; the
  # zkir params dir through MIDNIGHT_PP (checked before ~/.cache/midnight/zk-params).
  COMPACT_DIRECTORY = compact-toolchain;
  MIDNIGHT_PP = midnight-circuit-params;

  buildInputs = [
    nodejs
    compact-midnight
  ];

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

    # ---- hermetic pnpm
    export HOME="$NIX_BUILD_TOP/home"
    mkdir -p "$HOME"
    export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

    export COREPACK_HOME="$NIX_BUILD_TOP/corepack-home"
    mkdir -p "$COREPACK_HOME/bin"
    cp -R "${offlineStore}/corepack-home"/. "$COREPACK_HOME"/
    chmod -R u+w "$COREPACK_HOME"
    corepack enable --install-directory "$COREPACK_HOME/bin"
    export PATH="$COREPACK_HOME/bin:$PATH"

    # ---- offline store
    storeDir="$NIX_BUILD_TOP/pnpm-store"
    mkdir -p "$storeDir"
    cp -R "${offlineStore}/pnpm-store"/. "$storeDir"/
    chmod -R u+w "$storeDir"
    export npm_config_store_dir="$storeDir"

    # ---- install + pack
    pnpm install --offline --frozen-lockfile --ignore-scripts

    mkdir -p "$out"
    pnpm --filter "${pkg.name}" pack --pack-destination "$out"

    if [ ! -f "$out/${pkg.tarballName}" ]; then
      echo "ERROR: pnpm pack produced an unexpected tarball name for ${pkg.name}" >&2
      echo "expected: ${pkg.tarballName} (from manifest name + version ${pkg.version})" >&2
      echo "produced:" >&2
      ls -l "$out" >&2
      exit 1
    fi

    runHook postBuild
  '';

  meta = {
    description = "Hermetic pnpm pack tarball of ${pkg.name}@${pkg.version}";
  };
}
