import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import * as assert from "assert";
import {PublicKey, LAMPORTS_PER_SOL,Connection} from '@solana/web3.js';
import { Election } from "../target/types/election";

describe("election", () => {
  const ANCHOR_PROGRAM = anchor.workspace.Election as Program<Election>;
  const programPair = anchor.web3.Keypair.generate();

  function getProgramInteraction(): { user: anchor.web3.Keypair, program: Program<Election>, provider: anchor.Provider } {
    const user = anchor.web3.Keypair.generate();
    const provider = new anchor.AnchorProvider(anchor.AnchorProvider.local().connection, new anchor.Wallet(user), {});
    const program = new anchor.Program(ANCHOR_PROGRAM.idl as anchor.Idl, ANCHOR_PROGRAM.programId, provider) as Program<Election>
    return {user: user, program: program, provider: provider};
  }

  async function addFunds(user: anchor.web3.Keypair, amount: number, provider: anchor.Provider) {
    const airdrop_tx = await provider.connection.requestAirdrop(user.publicKey, amount)
    await provider.connection.confirmTransaction(airdrop_tx);
  }

  const {user,program, provider} = getProgramInteraction(); //user1
  const {user: user2, program: program2, provider: provider2} = getProgramInteraction(); //user2

  it("initializes the election account", async() => {
    const winners = 1;

    await addFunds(user,LAMPORTS_PER_SOL,provider);

    await program.methods.createElection(winners)
    .accounts({
        electionData: programPair.publicKey,
    })
    .signers([programPair])
    .rpc();

    const account = await program.account.electionData.fetch(programPair.publicKey);

    assert.equal(account.candidates.toNumber(), '0');
    assert.equal(account.winnersNum, winners);
    assert.equal(account.initiator.toBase58(), user.publicKey.toBase58());  
  });

  it("applies and register as a candidate (user 1)", async() => {
    const [candidateIdentityPDA,_] = await PublicKey.findProgramAddress(
      [
          anchor.utils.bytes.utf8.encode("candidate"),
          user.publicKey.toBytes(),
          programPair.publicKey.toBytes()
      ],
      program.programId
    )

    //Apply
    await program.methods.apply()
    .accounts({
        candidateIdentity: candidateIdentityPDA,
        electionData: programPair.publicKey,
    }).rpc();

    const candidateDetails = await program.account.candidateIdentity.fetch(candidateIdentityPDA);
    const electionDetails = await program.account.electionData.fetch(programPair.publicKey);

    assert.equal(electionDetails.candidates.toNumber(),'1');
    assert.equal(candidateDetails.id.toNumber(), '1');
    assert.equal(candidateDetails.pubkey.toBase58(), user.publicKey.toBase58());

    const [candidateDataPDA,_bump] = await PublicKey.findProgramAddress(
      [
          candidateDetails.id.toArrayLike(Array,"big",8),
          programPair.publicKey.toBytes()
      ],
      program.programId
    );

    //register
    await program.methods.register()
    .accounts({
        candidateData: candidateDataPDA,
        candidateIdentity: candidateIdentityPDA,
        electionData: programPair.publicKey,
    }).rpc();

    const candidateData = await program.account.candidateData.fetch(candidateDataPDA);
    assert.equal(candidateDetails.id.toNumber(), candidateData.id.toNumber());
    assert.equal(candidateDetails.pubkey.toBase58(), candidateData.pubkey.toBase58());
    assert.equal(candidateData.votes,'0');
  });

  it("applies and register as a candidate (user 2)", async() => {
    await addFunds(user2,LAMPORTS_PER_SOL,provider2);

    const [candidateIdentityPDA,_] = await PublicKey.findProgramAddress(
      [
          anchor.utils.bytes.utf8.encode("candidate"),
          user2.publicKey.toBytes(),
          programPair.publicKey.toBytes()
      ],
      program2.programId
    )

    await program2.methods.apply()
    .accounts({
        candidateIdentity: candidateIdentityPDA,
        electionData: programPair.publicKey,
    }).rpc();

    const candidateDetails = await program2.account.candidateIdentity.fetch(candidateIdentityPDA);
    const electionDetails = await program2.account.electionData.fetch(programPair.publicKey);

    assert.equal(electionDetails.candidates.toNumber(),'2');
    assert.equal(candidateDetails.id.toNumber(), '2');
    assert.equal(candidateDetails.pubkey.toBase58(), user2.publicKey.toBase58());

    const [candidateDataPDA,_bump] = await PublicKey.findProgramAddress(
      [
          candidateDetails.id.toArrayLike(Array,"big",8),
          programPair.publicKey.toBytes()
      ],
      program2.programId
    );

    //register
    await program2.methods.register()
    .accounts({
        candidateData: candidateDataPDA,
        candidateIdentity: candidateIdentityPDA,
        electionData: programPair.publicKey,
    }).rpc();

    const candidateData = await program2.account.candidateData.fetch(candidateDataPDA);
    assert.equal(candidateDetails.id.toNumber(), candidateData.id.toNumber());
    assert.equal(candidateDetails.pubkey.toBase58(), candidateData.pubkey.toBase58());
    assert.equal(candidateData.votes,'0');
  });

  it("changes the stage to voting",async() => {
    await program.methods.changeStage({voting: {}})
    .accounts({
        electionData: programPair.publicKey,
    }).rpc()

    const electionData = await program.account.electionData.fetch(programPair.publicKey);

    assert.equal(Object.keys(electionData.stage.voting).length,'0');
  });

  it("votes for user1 (from user1)",async() => {
    const id = 1;
    let id_BN: any = new anchor.BN(id).toArrayLike(Array,"big",8);

    const [candidatePDA,_bump] = await PublicKey.findProgramAddress(
        [
            id_BN,
            programPair.publicKey.toBytes()
        ],
        program.programId
    );

    const [myVotePDA,_] = await PublicKey.findProgramAddress(
        [
            anchor.utils.bytes.utf8.encode("voter"),
            user.publicKey.toBytes(),
            programPair.publicKey.toBytes()
        ],
        program.programId
    );

    await program.methods.vote().accounts({
        electionData: programPair.publicKey,
        myVote: myVotePDA,
        candidateData: candidatePDA
    }).rpc()

    const myVoteData = await program.account.myVote.fetch(myVotePDA);
    const candidateData = await program.account.candidateData.fetch(candidatePDA);

    assert.equal(myVoteData.id.toNumber(),id);
    assert.equal(candidateData.votes.toNumber(),'1');
  })

  it("votes for user1 (from user2)",async() => {
    const id = 1;
    let id_BN = new anchor.BN(id).toArrayLike(Array,"big",8);

    const [candidatePDA,_bump] = await PublicKey.findProgramAddress(
        [
            id_BN,
            programPair.publicKey.toBytes()
        ],
        program2.programId
    );

    const [myVotePDA,_] = await PublicKey.findProgramAddress(
        [
            anchor.utils.bytes.utf8.encode("voter"),
            user2.publicKey.toBytes(),
            programPair.publicKey.toBytes()
        ],
        program2.programId
    );

    await program2.methods.vote().accounts({
        electionData: programPair.publicKey,
        myVote: myVotePDA,
        candidateData: candidatePDA
    }).rpc()

    const myVoteData = await program2.account.myVote.fetch(myVotePDA);
    const candidateData = await program2.account.candidateData.fetch(candidatePDA);

    assert.equal(myVoteData.id.toNumber(),id);
    assert.equal(candidateData.votes.toNumber(),'2');
  });

  it("closes election and declare final winners",async() => {
    await program.methods.changeStage({closed: {}})
    .accounts({
        electionData: programPair.publicKey,
    }).rpc()

    const electionData = await program.account.electionData.fetch(programPair.publicKey);

    assert.equal(Object.keys(electionData.stage.closed).length,'0');
    assert.equal(electionData.winnersId[0].toNumber(),'1');
  });
});