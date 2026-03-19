/**
 * Basenames of dependency lock / pin files (all lowercase). Discovery matches
 * `path.basename(filePath).toLowerCase()` so files at any depth are recognized.
 *
 * Intentionally excludes ambiguous names (e.g. `manifest.toml`, `vcpkg.json`) that
 * are manifests or non-lock metadata and would false-positive.
 */
export const LOCKFILE_BASENAMES = new Set<string>([
  // --- Node.js / JavaScript / TypeScript ---
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "pnpm-lock.yml",
  "yarn.lock",
  ".yarn-integrity",
  "bun.lock",
  "bun.lockb",
  "deno.lock",

  // --- Python ---
  "poetry.lock",
  "pipfile.lock",
  "uv.lock",
  "pdm.lock",
  "pixi.lock",
  "conda-lock.yml",
  "conda-lock.yaml",
  "requirements.lock",
  "requirements_lock.txt",

  // --- Rust / Go ---
  "cargo.lock",
  "go.sum",
  "go.work.sum",
  "gopkg.lock",

  // --- Ruby / PHP / Perl ---
  "gemfile.lock",
  "gems.locked",
  "composer.lock",
  "symfony.lock",
  "cpanfile.snapshot",

  // --- BEAM (Elixir / Erlang) ---
  "mix.lock",
  "rebar.lock",

  // --- JVM ---
  "gradle.lockfile",
  "dependency-verification.xml",

  // --- .NET / NuGet ---
  "packages.lock.json",
  "paket.lock",
  "project.lock.json",

  // --- Swift / Apple ---
  "package.resolved",
  "podfile.lock",
  "cartfile.resolved",

  // --- Dart / Flutter ---
  "pubspec.lock",

  // --- Haskell ---
  "cabal.project.freeze",
  "stack.yaml.lock",

  // --- Nix ---
  "flake.lock",

  // --- Terraform / OpenTofu ---
  ".terraform.lock.hcl",

  // --- Kubernetes / Helm / protobuf tooling ---
  "chart.lock",
  "buf.lock",

  // --- HPC / ML reproducibility ---
  "spack.lock",
  "dvc.lock",

  // --- Homebrew bundle ---
  "brewfile.lock.json",

  // --- R ---
  "renv.lock",
  "packrat.lock",

  // --- Crystal / Nim ---
  "shard.lock",
  "nimble.lock",

  // --- OCaml ---
  "opam.locked",

  // --- C / C++ ---
  "conan.lock",

  // --- D (Dub) ---
  "dub.selections.json",

  // --- PureScript ---
  "spago.lock",

  // --- Chef / Puppet ---
  "berksfile.lock",
  "puppetfile.lock",

  // --- Bazel (JVM external deps pin file) ---
  "module.bazel.lock",
  "maven_install.json",
]);
