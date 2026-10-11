import dotenv from 'dotenv';
dotenv.config()


import UserModel from "../model/User.model.js";
import { comparePassword } from "../utils/helper.js";
import jwt from "jsonwebtoken"
import multer from 'multer';



export const verifyUser  = async(req, res, next)=>{
   try
   {
    const token = req.headers.authorization?.split(' ')[1]

    if(!token)return res.status(401).json({message: "No token in client side"})
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY)
    req.user = decoded 
    next()

    
   }catch(err){
    res.status(500).send({err : err.stack}) 
   }


   
}

const storage = multer.memoryStorage()

export const upload = multer({
   storage,
   limits:{
      fileSize: 10 * 1024 * 1024,
   }
})
