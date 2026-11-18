# SPDX-License-Identifier: Apache-2.0
#
# Pinned official compiler plus the devtool and circuit parameters from
# flake-collection, shared through the perSystem `toolchain` option.
{ lib, ... }:
{
  perSystem =
    {
      config,
      pkgs,
      inputs',
      ...
    }:
    let
      # Must agree with COMPACT_COMPILER_VERSION in CI and publication.
      compactCompilerVersion = "0.36.0";
    in
    {
      options.toolchain = lib.mkOption {
        type = lib.types.attrsOf lib.types.anything;
        readOnly = true;
        description = "Pinned Compact toolchain packages shared across this flake's modules.";
      };

      config = {
        toolchain = {
          compilerVersion = compactCompilerVersion;
          compact-midnight = inputs'.flake-collection.packages.compact-midnight;
          compact-toolchain = pkgs.callPackage ./compact-toolchain.nix { version = compactCompilerVersion; };
          midnight-circuit-params = inputs'.flake-collection.packages.midnight-circuit-params;
        };

        checks.pinned-compact-compiler-version =
          pkgs.runCommand "check-pinned-compact-compiler-version"
            {
              expected = compactCompilerVersion;
              actual = config.toolchain.compact-toolchain.version;
              meta.description = "Asserts the compact-toolchain version matches the pinned compiler version";
            }
            ''
              if [ "$actual" != "$expected" ]; then
                echo "ERROR: compact-toolchain version ($actual) != pin ($expected)" >&2
                echo "Align the pin in nix/toolchain.nix and COMPACT_COMPILER_VERSION in .github/workflows/ci.yml." >&2
                exit 1
              fi
              mkdir -p "$out"
            '';
      };
    };
}
