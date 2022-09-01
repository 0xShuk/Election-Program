use anchor_lang::prelude::*;
declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");
#[program]
pub mod election {
    use super::*;
    pub fn create_election(ctx: Context<CreateElection>,winners:u8) -> Result<()> {
        require!(winners > 0,ElectionError::WinnerCountNotAllowed);
        let election = &mut ctx.accounts.election_data;
    
        election.candidates = 0; 
        election.stage = ElectionStage::Application;
        election.initiator = ctx.accounts.signer.key();
        election.winners_num = winners;
        Ok(())
    }

    pub fn apply(ctx: Context<Apply>) -> Result<()> {
        let election = &mut ctx.accounts.election_data;

        require!(election.stage == ElectionStage::Application,ElectionError::ApplicationIsClosed);
        
        election.candidates += 1;
        ctx.accounts.candidate_identity.id = election.candidates;
        ctx.accounts.candidate_identity.pubkey = ctx.accounts.signer.key();
        Ok(())
    }

    pub fn register(ctx: Context<Register>) -> Result<()> {
        let candidate = &mut ctx.accounts.candidate_data;

        candidate.votes = 0;
        candidate.pubkey = ctx.accounts.signer.key();
        candidate.id = ctx.accounts.candidate_identity.id;
    
        Ok(())
    }

    pub fn change_stage(ctx: Context<ChangeStage>,new_stage: ElectionStage) -> Result<()> {
        let election = &mut ctx.accounts.election_data;
    
        require!(election.stage != ElectionStage::Closed,ElectionError::ElectionIsClosed);
    
        match new_stage {
            ElectionStage::Voting => {
                return election.close_application();
            },
            ElectionStage::Closed => {
                return election.close_voting();
            },
            ElectionStage::Application => {
                return Err(ElectionError::PrivilegeNotAllowed.into());
            }
        }
    }

    pub fn vote(ctx: Context<Vote>) -> Result<()> {
        let election = &mut ctx.accounts.election_data;
    
        require!(election.stage == ElectionStage::Voting,ElectionError::NotAtVotingStage);
    
        let candidate = &mut ctx.accounts.candidate_data;
        let my_vote = &mut ctx.accounts.my_vote;
    
        candidate.votes += 1;
        my_vote.id = candidate.id;
    
        election.record_vote(candidate.id,candidate.votes);
        
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(winners:u8)]
pub struct CreateElection<'info> {
    #[account(
        init,
        payer=signer,
        space= 8 + 8 + 2 + 32 + 1 + 2 * (4 + winners as usize * 8)
    )]
    pub election_data: Account<'info,ElectionData>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info,System>
}

#[derive(Accounts)]
pub struct Apply<'info> {
    #[account(
        init,
        payer=signer,
        space=8+8+32,
        seeds=[
            b"candidate",
            signer.key().as_ref(),
            election_data.key().as_ref()
        ],
        bump
    )]
    pub candidate_identity: Account<'info,CandidateIdentity>,
    #[account(mut)]
    pub election_data: Account<'info,ElectionData>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info,System>
}

#[derive(Accounts)]
pub struct Register<'info> {
    #[account(
        init,
        payer=signer,
        space=8+8+8+32,
        seeds=[
            &(candidate_identity.id).to_be_bytes(),
            election_data.key().as_ref()
        ],
        bump
    )]
    pub candidate_data: Account<'info,CandidateData>,
    pub election_data: Account<'info,ElectionData>,
    pub candidate_identity: Account<'info,CandidateIdentity>,
    #[account(mut,address=candidate_identity.pubkey @ ElectionError::WrongPublicKey)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info,System>
}

#[derive(Accounts)]
pub struct ChangeStage<'info> {
    #[account(mut)]
    pub election_data: Account<'info,ElectionData>,

    #[account(mut,address=election_data.initiator @ ElectionError::PrivilegeNotAllowed)]
    pub signer: Signer<'info>
}

#[derive(Accounts)]
pub struct Vote<'info> {
    #[account(
        init,
        payer=signer,
        space=8+8,
        seeds=[
            b"voter",
            signer.key().as_ref(),
            election_data.key().as_ref()
        ],
        bump
    )]
    pub my_vote: Account<'info,MyVote>,
    #[account(mut)]
    pub candidate_data: Account<'info,CandidateData>,
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(mut)]
    pub election_data: Account<'info,ElectionData>,
    pub system_program: Program<'info,System>
}

#[account]
pub struct ElectionData {
    pub candidates: u64,
    pub stage: ElectionStage,
    pub initiator: Pubkey,
    pub winners_num: u8,
    pub winners_id: Vec<u64>,
    pub winners_votes: Vec<u64>,
}

#[account]
pub struct CandidateData {
    pub votes: u64,
    pub id: u64,
    pub pubkey: Pubkey,
}

#[account]
pub struct CandidateIdentity {
    pub id: u64,
    pub pubkey: Pubkey,
}

#[account]
pub struct MyVote {
    pub id: u64,
}

impl ElectionData {
    pub fn close_application(&mut self) -> Result<()> {
        require!(self.stage == ElectionStage::Application,ElectionError::ApplicationIsClosed);

        if self.candidates <= self.winners_num as u64 {
            for i in 1..self.candidates + 1 {
                self.winners_id.push(i);
                self.stage = ElectionStage::Closed;
            }
        } else {
            self.stage = ElectionStage::Voting;
        }
        Ok(())
    }

    pub fn close_voting(&mut self) -> Result<()> {
        require!(self.stage == ElectionStage::Voting,ElectionError::NotAtVotingStage);
        self.stage = ElectionStage::Closed;
        Ok(())
    }

    pub fn record_vote(&mut self,id: u64,votes: u64) {
        if !self.winners_id.contains(&id) {
            if self.winners_id.len() < self.winners_num as usize {
                self.winners_id.push(id);
                self.winners_votes.push(votes);            
            } else {
                let current_last_winner = (self.winners_num - 1) as usize;

                if votes > self.winners_votes[current_last_winner] {
                    self.winners_id[current_last_winner] = id;
                    self.winners_votes[current_last_winner] = votes;
                } else {
                    return;
                }
            }
        } else {
            let index = self.winners_id.iter().position(|&r| r == id).unwrap();
            self.winners_votes[index] += 1;
        }
        
        //sorting votes in descending order if winners' votes are changed
        let mut j = self.winners_id.iter().position(|&r| r == id).unwrap();

        while j > 0 && self.winners_votes[j] > self.winners_votes[j-1] {

            let vote_holder = self.winners_votes[j-1];
            let id_holder = self.winners_id[j-1];

            self.winners_votes[j-1] = self.winners_votes[j];
            self.winners_votes[j] = vote_holder;

            self.winners_id[j-1] = self.winners_id[j];
            self.winners_id[j] = id_holder;

            j -= 1;
        }
    }
}

#[derive(AnchorDeserialize,AnchorSerialize,PartialEq,Eq,Clone)]
pub enum ElectionStage {
    Application,
    Voting,
    Closed,
}

#[error_code]
pub enum ElectionError {
    WinnerCountNotAllowed,
    ApplicationIsClosed,
    WrongPublicKey,
    PrivilegeNotAllowed,
    ElectionIsClosed,
    NotAtVotingStage
}