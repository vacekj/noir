use super::{
    code_gen::IRGenerator,
    node::{self, NodeId},
};
use std::collections::{HashMap, VecDeque};

#[derive(PartialEq, Debug)]
pub enum BlockType {
    Normal,
    ForJoin,
}

#[derive(Debug, Copy, Clone, PartialEq, Eq, Hash)]
pub struct BlockId(pub arena::Index);

impl BlockId {
    pub fn dummy() -> BlockId {
        BlockId(IRGenerator::dummy_id())
    }
}

#[derive(Debug)]
pub struct BasicBlock {
    pub id: BlockId,
    pub kind: BlockType,
    pub dominator: Option<BlockId>, //direct dominator
    pub dominated: Vec<BlockId>,    //dominated sons
    pub predecessor: Vec<BlockId>,  //for computing the dominator tree
    pub left: Option<BlockId>,      //sequential successor
    pub right: Option<BlockId>,     //jump successor
    pub instructions: Vec<NodeId>,
    pub value_map: HashMap<NodeId, NodeId>, //for generating the ssa form
}

impl BasicBlock {
    pub fn new(prev: BlockId, kind: BlockType) -> BasicBlock {
        BasicBlock {
            id: BlockId(IRGenerator::dummy_id()),
            predecessor: vec![prev],
            left: None,
            right: None,
            instructions: Vec::new(),
            value_map: HashMap::new(),
            dominator: None,
            dominated: Vec::new(),
            kind,
        }
    }

    pub fn get_current_value(&self, id: NodeId) -> Option<NodeId> {
        self.value_map.get(&id).copied()
    }

    //When generating a new instance of a variable because of ssa, we update the value array
    //to link the two variables
    pub fn update_variable(&mut self, old_value: NodeId, new_value: NodeId) {
        self.value_map.insert(old_value, new_value);
    }

    pub fn get_first_instruction(&self) -> NodeId {
        self.instructions[0]
    }

    pub fn is_join(&self) -> bool {
        self.kind == BlockType::ForJoin
    }
}

pub fn create_first_block(igen: &mut IRGenerator) {
    let first_block = BasicBlock::new(BlockId::dummy(), BlockType::Normal);
    let first_block = igen.insert_block(first_block);
    let first_id = first_block.id;
    igen.first_block = first_id;
    igen.current_block = first_id;
    igen.new_instruction(
        NodeId::dummy(),
        NodeId::dummy(),
        node::Operation::Nop,
        node::ObjectType::NotAnObject,
    );
}

//Creates a new sealed block (i.e whose predecessors are known)
//It is not suitable for the first block because it uses the current block.
pub fn new_sealed_block(igen: &mut IRGenerator, kind: BlockType) -> BlockId {
    let current_block = igen.current_block;
    let new_block = BasicBlock::new(igen.current_block, kind);
    let new_block = igen.insert_block(new_block);
    let new_id = new_block.id;

    new_block.dominator = Some(current_block);
    igen.sealed_blocks.insert(new_id);

    //update current block
    let cb = igen.get_current_block_mut();
    cb.left = Some(new_id);
    igen.current_block = new_id;
    igen.new_instruction(
        NodeId::dummy(),
        NodeId::dummy(),
        node::Operation::Nop,
        node::ObjectType::NotAnObject,
    );
    new_id
}

//if left is true, the new block is left to the current block
pub fn new_unsealed_block(igen: &mut IRGenerator, kind: BlockType, left: bool) -> BlockId {
    let current_block = igen.current_block;
    let new_block = create_block(igen, kind);
    new_block.dominator = Some(current_block);
    let new_idx = new_block.id;

    //update current block
    let cb = igen.get_current_block_mut();
    if left {
        cb.left = Some(new_idx);
    } else {
        cb.right = Some(new_idx);
    }

    igen.current_block = new_idx;
    igen.new_instruction(
        NodeId::dummy(),
        NodeId::dummy(),
        node::Operation::Nop,
        node::ObjectType::NotAnObject,
    );
    new_idx
}

//create a block and sets its id, but do not update current block, and do not add dummy instruction!
pub fn create_block<'a>(igen: &'a mut IRGenerator, kind: BlockType) -> &'a mut BasicBlock {
    let new_block = BasicBlock::new(igen.current_block, kind);
    igen.insert_block(new_block)
}

//link the current block to the target block so that current block becomes its target
pub fn link_with_target(
    igen: &mut IRGenerator,
    target: BlockId,
    left: Option<BlockId>,
    right: Option<BlockId>,
) {
    if let Some(target_block) = igen.try_get_block_mut(target) {
        target_block.right = right;
        target_block.left = left;
        //TODO should also update the last instruction rhs to the first instruction of the current block  -- TODOshoud we do it here??
        if let Some(right_uw) = right {
            igen[right_uw].dominator = Some(target);
        }
        if let Some(left_uw) = left {
            igen[left_uw].dominator = Some(target);
        }
    }
}

pub fn compute_dom(igen: &mut IRGenerator) {
    let mut dominator_link = HashMap::new();

    for block in igen.iter_blocks() {
        if let Some(dom) = block.dominator {
            dominator_link.entry(dom).or_insert(vec![]).push(block.id);
            // dom_block.dominated.push(idx);
        }
    }
    //RIA
    for (master, svec) in dominator_link {
        let dom_b = &mut igen[master];
        for slave in svec {
            dom_b.dominated.push(slave);
        }
    }
}

//breadth-first traversal of the CFG, from start, until we reach stop
pub fn bfs(start: BlockId, stop: BlockId, igen: &IRGenerator) -> Vec<BlockId> {
    let mut result = vec![start]; //list of blocks in the visited subgraph
    let mut queue = VecDeque::new(); //Queue of elements to visit
    queue.push_back(start);

    while !queue.is_empty() {
        let block = &igen[queue.pop_front().unwrap()];

        let mut test_and_push = |block_opt| {
            if let Some(block_id) = block_opt {
                if block_id != stop && !result.contains(&block_id) {
                    result.push(block_id);
                    queue.push_back(block_id);
                }
            }
        };

        test_and_push(block.left);
        test_and_push(block.right);
    }

    result
}