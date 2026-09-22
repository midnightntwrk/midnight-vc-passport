# SPDX-License-Identifier: Apache-2.0
#
# Reproducible dev shell and hermetic npm artifact packaging. The flake logic
# lives in flake-parts modules under ./nix.
{
  description = "Midnight verifiable credential: digital passport — development environment and npm artifact packaging";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    # Provides compact-toolchain, compact-midnight and midnight-circuit-params.
    flake-collection.url = "github:MediaNoxLabs/flake-collection";
    flake-collection.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs =
    inputs@{
      self,
      flake-parts,
      ...
    }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [
        "x86_64-linux"
        "aarch64-darwin"
      ];

      imports = [
        ./nix/nixpkgs.nix
        ./nix/toolchain.nix
        ./nix/npm-artifacts.nix
        ./nix/devshell.nix
      ];
    };
}
