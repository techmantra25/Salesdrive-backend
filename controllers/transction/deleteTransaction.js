const asyncHandler = require("express-async-handler");
const Transaction = require("../../models/transaction.model");

const deleteTransaction = asyncHandler(async(req,res) =>{
    //we will delete the transaction 
    try{
        //id from the frontend
        const {id} = req.params;
        if(!id){
            return res.status(400).json({
                success:false,
                message:"Transaction ID is required",
            })
        }

        //finding the transaction to delete
        const transactionToDelete = await Transaction.findByIdAndDelete(id);

        //if transactiond does not exists then throw errror
        if(!transactionToDelete){
            return res.status(400).json({
                success:false,
                message:"Transaction not found",
            })
        }
        //else give positive respone
        res.status(200).json({
            success:true,
            message:"Transaction deleted successfully",
            data:transactionToDelete,
        })

    }
    
    catch(error){
        res.status(500).json({
            success:false,
            message:"Error deleting transaction",
            error:error.message,
        })
    }
})

module.exports = {deleteTransaction};