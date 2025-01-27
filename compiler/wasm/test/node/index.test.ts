import { expect } from 'chai';
import {
  depsScriptSourcePath,
  depsScriptExpectedArtifact,
  libASourcePath,
  libBSourcePath,
  simpleScriptSourcePath,
  simpleScriptExpectedArtifact,
} from '../shared';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { compile, compile_, CompilerContext, PathToFileSourceMap } from '@noir-lang/noir_wasm';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getPrecompiledSource(path: string): Promise<any> {
  const compiledData = readFileSync(resolve(__dirname, path)).toString();
  return JSON.parse(compiledData);
}

describe('noir wasm compilation', () => {
  describe('can compile simple scripts', () => {
    it('matching nargos compilation', async () => {
      const sourceMap = new PathToFileSourceMap();
      sourceMap.add_source_code(
        join(__dirname, simpleScriptSourcePath),
        readFileSync(join(__dirname, simpleScriptSourcePath), 'utf-8'),
      );
      const wasmCircuit = await compile(join(__dirname, simpleScriptSourcePath), undefined, undefined, sourceMap);
      const cliCircuit = await getPrecompiledSource(simpleScriptExpectedArtifact);

      if (!('program' in wasmCircuit)) {
        throw Error('Expected program to be present');
      }

      // We don't expect the hashes to match due to how `noir_wasm` handles dependencies
      expect(wasmCircuit.program.noir_version).to.eq(cliCircuit.noir_version);
      expect(wasmCircuit.program.bytecode).to.eq(cliCircuit.bytecode);
      expect(wasmCircuit.program.abi).to.deep.eq(cliCircuit.abi);
    }).timeout(10e3);
  });

  describe('can compile scripts with dependencies', () => {
    const sourceMap: PathToFileSourceMap = new PathToFileSourceMap();
    beforeEach(() => {
      sourceMap.add_source_code('script/main.nr', readFileSync(join(__dirname, depsScriptSourcePath), 'utf-8'));
      sourceMap.add_source_code('lib_a/lib.nr', readFileSync(join(__dirname, libASourcePath), 'utf-8'));
      sourceMap.add_source_code('lib_b/lib.nr', readFileSync(join(__dirname, libBSourcePath), 'utf-8'));
    });

    it('matching nargos compilation', async () => {
      const wasmCircuit = await compile(
        'script/main.nr',
        false,
        {
          root_dependencies: ['lib_a'],
          library_dependencies: {
            lib_a: ['lib_b'],
          },
        },
        sourceMap,
      );

      const cliCircuit = await getPrecompiledSource(depsScriptExpectedArtifact);

      if (!('program' in wasmCircuit)) {
        throw Error('Expected program to be present');
      }

      // We don't expect the hashes to match due to how `noir_wasm` handles dependencies
      expect(wasmCircuit.program.noir_version).to.eq(cliCircuit.noir_version);
      expect(wasmCircuit.program.bytecode).to.eq(cliCircuit.bytecode);
      expect(wasmCircuit.program.abi).to.deep.eq(cliCircuit.abi);
    }).timeout(10e3);
  });

  describe('can compile scripts with dependencies -- context-api', () => {
    let sourceMap: PathToFileSourceMap;
    beforeEach(() => {
      sourceMap = new PathToFileSourceMap();
      sourceMap.add_source_code('script/main.nr', readFileSync(join(__dirname, depsScriptSourcePath), 'utf-8'));
      sourceMap.add_source_code('lib_a/lib.nr', readFileSync(join(__dirname, libASourcePath), 'utf-8'));
      sourceMap.add_source_code('lib_b/lib.nr', readFileSync(join(__dirname, libBSourcePath), 'utf-8'));
    });

    it('matching nargos compilation - context-api', async () => {
      const compilerContext = new CompilerContext(sourceMap);

      // Process root crate
      const root_crate_id = compilerContext.process_root_crate('script/main.nr');
      // Process dependencies
      //
      // This can be direct dependencies or transitive dependencies
      // I have named these crate_id_1 and crate_id_2 instead of `lib_a_crate_id` and `lib_b_crate_id`
      // because the names of crates in a dependency graph are not determined by the actual package.
      //
      // It is true that each package is given a name, but if I include a `lib_a` as a dependency
      // in my library, I do not need to refer to it as `lib_a` in my dependency graph.
      // See https://doc.rust-lang.org/cargo/reference/specifying-dependencies.html#renaming-dependencies-in-cargotoml
      //
      // If you have looked at graphs before, then you can think of the dependency graph as a directed acyclic graph (DAG)
      const crate_id_1 = compilerContext.process_dependency_crate('lib_a/lib.nr');
      const crate_id_2 = compilerContext.process_dependency_crate('lib_b/lib.nr');

      // Root crate depends on `crate_id_1` and this edge is called `lib_a`
      compilerContext.add_dependency_edge('lib_a', root_crate_id, crate_id_1);
      // `crate_id_1` depends on `crate_id_2` and this edge is called `lib_b`
      compilerContext.add_dependency_edge('lib_b', crate_id_1, crate_id_2);

      const program_width = 3;
      const wasmCircuit = await compilerContext.compile_program(program_width);

      const cliCircuit = await getPrecompiledSource(depsScriptExpectedArtifact);

      if (!('program' in wasmCircuit)) {
        throw Error('Expected program to be present');
      }

      // We don't expect the hashes to match due to how `noir_wasm` handles dependencies
      expect(wasmCircuit.program.noir_version).to.eq(cliCircuit.noir_version);
      expect(wasmCircuit.program.bytecode).to.eq(cliCircuit.bytecode);
      expect(wasmCircuit.program.abi).to.deep.eq(cliCircuit.abi);
    }).timeout(10e3);

    it('matching nargos compilation - context-implementation-compile-api', async () => {
      const wasmCircuit = await compile_(
        'script/main.nr',
        false,
        {
          root_dependencies: ['lib_a'],
          library_dependencies: {
            lib_a: ['lib_b'],
          },
        },
        sourceMap,
      );

      const cliCircuit = await getPrecompiledSource(depsScriptExpectedArtifact);

      if (!('program' in wasmCircuit)) {
        throw Error('Expected program to be present');
      }

      // We don't expect the hashes to match due to how `noir_wasm` handles dependencies
      expect(wasmCircuit.program.noir_version).to.eq(cliCircuit.noir_version);
      expect(wasmCircuit.program.bytecode).to.eq(cliCircuit.bytecode);
      expect(wasmCircuit.program.abi).to.deep.eq(cliCircuit.abi);
    }).timeout(10e3);
  });
});
