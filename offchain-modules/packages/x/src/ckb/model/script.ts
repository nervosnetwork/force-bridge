import { Script, HashType } from '@ckb-lumos/lumos';

type ScriptLikeTypes = Script;

export class ScriptLike {
  constructor(public codeHash: string, public args: string, public hashType: HashType) {}

  static isCKBComponentScript(script: ScriptLikeTypes): script is CKBComponents.Script {
    return 'codeHash' in script && 'args' in script && 'hashType' in script;
  }

  static from(script: ScriptLikeTypes): ScriptLike {
    if (ScriptLike.isCKBComponentScript(script) || script instanceof ScriptLike) {
      return new ScriptLike(script.codeHash, script.args, script.hashType);
    }

    throw new Error('ScriptLike.from only supported ScriptLike | CKBComponents.Script | PWScript | IndexerScript');
  }

  equals(script: ScriptLikeTypes): boolean {
    const { codeHash, args, hashType } = this;

    return codeHash === script.codeHash && args === script.args && hashType === script.hashType;
  }
}
