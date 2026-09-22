# SPDX-License-Identifier: Apache-2.0
{ ... }:
{
  perSystem =
    { config, pkgs, ... }:
    {
      devShells.default = pkgs.mkShell {
        packages =
          with pkgs;
          [
            git
            gnutar
            nodejs_24
            turbo
          ]
          ++ [
            config.toolchain.compact-midnight
            config.toolchain.compact-toolchain
          ];

        shellHook = ''
          export COMPACT_DIRECTORY=${config.toolchain.compact-toolchain}

          # pnpm via corepack honors the `packageManager` pin in package.json.
          export COREPACK_HOME="''${COREPACK_HOME:-$HOME/.cache/node/corepack}"
          mkdir -p "$COREPACK_HOME/bin"
          corepack enable --install-directory "$COREPACK_HOME/bin" >/dev/null 2>&1 || true
          export PATH="$COREPACK_HOME/bin:$PATH"

          # Circuit params read straight from the flake input (takes precedence
          # over ~/.cache/midnight/zk-params, no copying into $HOME).
          export MIDNIGHT_PP=${config.toolchain.midnight-circuit-params}
        '';
      };
    };
}
