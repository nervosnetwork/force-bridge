
export type CkbMint = {
    name: 'CkbMint',
}

export type CkbBurn ={
    name: 'CkbBurn',
}

export type EthLock ={
    name: 'EthLock',

}

export type EthUnlock ={
    name: 'EthUnlock',

}

export type BtcLock ={
    name: 'BtcLock',

}

export type BtcUnlock ={
    name: 'BtcUnlock',
}

export type XchainUnlock = EthUnlock | BtcUnlock
export async function transformBurnEvent(burn: CkbBurn): Promise<XchainUnlock> {
    throw new Error('Method not implemented.')
}

export type XchainLock = EthLock | BtcLock
export async function transformMintEvent(burn: XchainLock): Promise<CkbMint> {
    throw new Error('Method not implemented.')
}
