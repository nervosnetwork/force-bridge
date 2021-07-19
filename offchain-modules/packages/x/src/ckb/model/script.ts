import { Script as PWScript, HashType } from '@lay2/pw-core';

type IndexerScript = {
  code_hash: string;
  args: string;
  hash_type: 'data' | 'type';
};

type ScriptLikeTypes = ScriptLike | CKBComponents.Script | PWScript | IndexerScript;

export class ScriptLike {
  constructor(public codeHash: string, public args: string, public hashType: 'data' | 'type') {}

  static isCKBComponentScript(script: ScriptLikeTypes): script is CKBComponents.Script {
    return 'codeHash' in script && 'args' in script && 'hashType' in script;
  }

  static isPWScript(script: ScriptLikeTypes): script is PWScript {
    return script instanceof PWScript;
  }

  static isIndexerScript(script: ScriptLikeTypes): script is IndexerScript {
    return 'code_hash' in script && 'args' in script && 'hash_type' in script;
  }

  static from(script: ScriptLikeTypes): ScriptLike {
    if (ScriptLike.isPWScript(script) || ScriptLike.isCKBComponentScript(script) || script instanceof ScriptLike) {
      return new ScriptLike(script.codeHash, script.args, script.hashType);
    }

    if (ScriptLike.isIndexerScript(script)) {
      return new ScriptLike(script.code_hash, script.args, script.hash_type);
    }

    throw new Error('ScriptLike.from only supported ScriptLike | CKBComponents.Script | PWScript | IndexerScript');
  }

  equals(script: ScriptLikeTypes): boolean {
    const { codeHash, args, hashType } = this;

    if (ScriptLike.isPWScript(script)) {
      return (
        script.args === args &&
        script.codeHash === codeHash &&
        ((script.hashType === HashType.data && hashType === 'data') ||
          (script.hashType === HashType.type && hashType === 'type'))
      );
    }

    if (ScriptLike.isCKBComponentScript(script) || script instanceof ScriptLike) {
      return codeHash === script.codeHash && args === script.args && hashType === script.hashType;
    }

    if (ScriptLike.isIndexerScript(script)) {
      return script.code_hash === codeHash && script.args === args && script.hash_type === script.hash_type;
    }

    return false;
  }

  toCKBComponentScript(): CKBComponents.Script {
    return { codeHash: this.codeHash, args: this.args, hashType: this.hashType };
  }

  toPWScript(): PWScript {
    return new PWScript(this.codeHash, this.args, this.hashType === 'type' ? HashType.type : HashType.data);
  }

  toIndexerScript(): IndexerScript {
    return { code_hash: this.codeHash, args: this.args, hash_type: this.hashType };
  }
}
