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
const hello = "whats up"


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

let jobData;

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
                       text :`You are a resume parser. Extract structured information from the resume below and return ONLY a valid JSON object with no extra text, no markdown, no backticks, no explanations.

                                            Return exactly this structure:

                                            {
                                            "basics": {
                                                "name": "",
                                                "title": "",
                                                "avatar_initials": "",
                                                "summary": "",
                                                "contact_details": [
                                                { "type": "email", "detail": "" },
                                                { "type": "phone", "detail": "" },
                                                { "type": "location", "detail": "" }
                                                ]
                                            },
                                            "stats": [
                                                { "count": "", "type": "exp" },
                                                { "count": "", "type": "Positions" },
                                                { "count": "", "type": "Skills" },
                                                { "count": "", "type": "Degrees" }
                                            ],
                                            "experience": [
                                                {
                                                "role": "",
                                                "company": "",
                                                "period": "",
                                                "description": ""
                                                }
                                            ],
                                            "skills": [
                                                { "label": "", "category": "technical" },
                                                { "label": "", "category": "domain" },
                                                { "label": "", "category": "soft" },
                                                { "label": "", "category": "tool" }
                                            ],
                                            "education": [
                                                {
                                                "degree": "",
                                                "school": "",
                                                "year": "",
                                                "gpa": "",
                                                "honors": ""
                                                }
                                            ],
                                            "certifications": [
                                                { "name": "" }
                                            ],
                                            "languages": [
                                                { "name": "", "proficiency": "", "level": 0 }
                                            ],
                                            "projects": [
                                                {
                                                "name": "",
                                                "type": "github",
                                                "description": ""
                                                }
                                            ]
                                            }

                                            Rules:
                                            - avatar_initials should be the first letters of first and last name e.g. "JD" for Jane Doe
                                            - stats.count should be a string number e.g. "7"
                                            - stats for exp = total years of experience, Positions = number of jobs, Skills = total skills count, Degrees = number of degrees
                                            - skills category must be exactly one of: technical, domain, soft, tool
                                            - languages level must be a number 0 to 100 — Native=100, Fluent=75, Conversational=50, Basic=35
                                            - projects type must be exactly one of: github, article, other
                                            - if a field is not found in the resume leave it as empty string or empty array
                                            - return ALL experience entries, ALL skills, ALL education, ALL certifications, ALL languages, ALL projects found

                                            `
                        
                    

                     },
                ]
            }
        ]
        });
       
        return res.status(201).json({response:response.text})

    
        
    } catch (error) {
       return res.status(401).json({
        message: error.message,
       })
    }

}
export async function getMatchingJobs(req, res) {
    try {
        const {resumeInfo} = req.body
         
        const db = mongoose.connection.db;
        const jobs = await db.collection("users").find().toArray()
        const stringified = await JSON.stringify(jobs)
      
        
        const response = await client.models.generateContent({
             model: "gemini-2.5-flash",
             contents:[
               
                {
                    role:"user",
                    parts:[
                        {text:`You are an ATS (Applicant Tracking System).

                    You are given:

                    1. A user's resume.
                    2. A list of job objects.

                    Your task is to compare the resume against every job.

                    Matching criteria:
                    - Skills
                    - Experience
                    - Education
                    - Technologies
                    - Responsibilities
                    - Job title
                    - Relevant keywords

                    Rules:
                    - Return ONLY jobs that are a good match.
                    - Do NOT rewrite, summarize, or modify any job.
                    - Preserve every property exactly as it appears.
                    - Preserve nested objects and arrays.
                    - Do NOT add new properties.
                    - Do NOT remove existing properties from matching jobs.
                    - If no jobs match, return [].
                    - Return ONLY valid JSON.
                    - Do not wrap it in markdown.
                    - Do not explain your reasoning.

                    Resume:
                    ${JSON.stringify(resumeInfo)}

                    Jobs:
                    ${stringified}
                    `}
                    ]
                }
              ]
             
        })   
        console.log(response.text)
       
    } catch (error) {
        return res.status(500).json({response:error.message})
    }
}