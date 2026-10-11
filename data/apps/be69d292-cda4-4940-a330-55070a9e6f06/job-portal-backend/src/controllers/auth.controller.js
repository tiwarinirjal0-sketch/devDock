import dotenv from 'dotenv'
dotenv.config()

import UserModel from '../model/User.model.js';
import jwt from 'jsonwebtoken';
import { hashPassword, comparePassword } from '../utils/helper.js';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { GoogleGenAI } from '@google/genai';

const client =  new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
});

connectDB()



export async function register(req, res) {
    try {
        const { username, password, email, profile } = req.body;

        const existingUsername = await UserModel.findOne({ username });
        if (existingUsername) return res.status(400).send({ error: 'Username err' });

        const existingEmail = await UserModel.findOne({ email });
        if (existingEmail) return res.status(400).send({ error: 'Email err' });

        const hashedPassword = await hashPassword(password);
        const newUser = await new UserModel({ username, password: hashedPassword, profile: profile || '', email }).save();

        const token = jwt.sign({_id : newUser._id}, process.env.JWT_SECRET_KEY, {expiresIn:'7d'})
        res.status(201).json({"message":"token sent successfully", token})

    } catch (err) {
        return res.status(500).send({err});
    }
}

export async function login(req, res) {
    try {
        const { email, password } = req.body;

        const user = await UserModel.findOne({ email });
        if (!user) return res.status(404).send({ error: 'User Not Found' });

        const isMatch = await comparePassword(password, user.password);
        if (!isMatch) return res.status(400).send({ error: 'Invalid Password' });

        const token = jwt.sign({ userId: user._id, username: user.username }, process.env.JWT_SECRET_KEY, { expiresIn: '7d' });

        return res.status(201).send({ msg: 'Login Successful', token });
    } catch (err) {
        console.error(err)
        return res.status(400).json({message : err.message});
    }
}

export async function getJobs(req, res){
    try {
        const db = mongoose.connection.db;
        const jobs = await db.collection("users").find().toArray()
        return res.status(200).json(jobs)
    } catch (error) {
        console.log("error happend", error)
    }

}

export async function resumeData(req, res){
    try {
        res.status(201).json({message: "data received"})
        
    } catch (error) {
        console.log("error: ", error)
    }
}

export async function Ai(req, res){
    try {
        if(!req.file)return res.status(401).json({message:"no file added"})
        
       const response = await client.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
            {
                role:"user",
                parts : [
                    {
                        inlineData:{
                            data:req.file.buffer.toString("base64"),
                            mimeType: req.file.mimetype,
                        },

                    },
                    {
                       text : "You are a resume parser.Extract at least 50 important keywords from the resume below.Rules:- Identify technical skills, domains, tools, frameworks, and industries.- Also classify if the resume is related to tech, finance, engineering, business, etc.- Return ONLY a JSON array of keywords.- No explanations."
                        
                    

                     },
                ]
            }
        ]
        });
        res.status(201).json({response:response.text})

    
        
    } catch (error) {
       res.status(401).json({
        message: error.message,
       })
    }

}

