import { Script, HashType } from '@ckb-lumos/lumos';
import { Script as PWScript } from '@lay2/pw-core';

type ScriptLikeTypes = Script;

export class ScriptLike {
  constructor(public codeHash: string, public args: string, public hashType: HashType) {}

  static isCKBComponentScript(script: ScriptLikeTypes): script is CKBComponents.Script {
    return 'codeHash' in script && 'args' in script && 'hashType' in script;
  }

  static isPWScript(script: ScriptLikeTypes): script is PWScript {
    return script instanceof PWScript;
  }

  static from(script: ScriptLikeTypes): ScriptLike {
    if (ScriptLike.isPWScript(script) || ScriptLike.isCKBComponentScript(script) || script instanceof ScriptLike) {
      return new ScriptLike(script.codeHash, script.args, script.hashType);
    }

    throw new Error('ScriptLike.from only supported ScriptLike | CKBComponents.Script | PWScript | IndexerScript');
  }

  equals(script: ScriptLikeTypes): boolean {
    const { codeHash, args, hashType } = this;

    if (ScriptLike.isPWScript(script)) {
      return (
        script.args === args &&
        script.codeHash === codeHash &&
        ((script.hashType === 'data' && hashType === 'data') || (script.hashType === 'type' && hashType === 'type'))
      );
    }

    return codeHash === script.codeHash && args === script.args && hashType === script.hashType;

    return false;
  }
}
