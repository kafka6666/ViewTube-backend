import {asyncHandler} from "../utils/asyncHandler.util.js";
import {ApiError} from "../utils/ApiError.util.js";
import {User} from "../models/user.model.js";
import {uploadOnCloudinary} from "../utils/cloudinary.util.js";
import {ApiResponse} from "../utils/ApiResponse.util.js";

const registerUser = asyncHandler(async (req, res) => {
    // get user data from the frontend client
    const {fullName, username, email, password} = req.body;
    console.log("email: ", email);

    // validate the user data - check if all fields are not null
    if ([fullName, username, email, password].some((field) => field.trim() === "")) {
        throw new ApiError(400, "All fields are required");
    }

    if (email.includes("@") === false) {
        throw new ApiError(400, "Invalid email address");
    }

    // check if the user already exists using username and email
    const existingUser = await User.findOne({
        $or: [{username}, {email}],
    });

    if (existingUser) {
        throw new ApiError(409, "User already exists");
    }

    // check for images and avatars
    const avatarLocalPath = req.files?.avatar[0]?.path;
    const coverImageLocalPath = req.files?.coverImage[0]?.path;

    if (!avatarLocalPath) {
        throw new ApiError(400, "Avatar file is required");
    }

    // if available, upload the images and avatars to cloudinary and check whether the avatar upload was successful
    const avatar = await uploadOnCloudinary(avatarLocalPath);
    const coverImage = await uploadOnCloudinary(coverImageLocalPath);
    console.log("coverImage: ", coverImage);

    if (!avatar) {
        throw new ApiError(500, "Avatar file upload failed");
    }

    // create a new user object - create entry in db
    const user = await User.create({
        fullName,
        username: username.toLowerCase(),
        email,
        password,
        avatar: avatar.url,
        coverImage: coverImage?.url || null,
    });

    // remove password and refresh token fields from response obtained from the db
    const createdUser = await User.findById(user._id).select(
      "-password -refreshToken"
    );

    // check for user creation and send error message if not created
    if (!createdUser) {
        throw new ApiError(500, "Something went wrong while registering the user");
    }

    // send the response back to the client
    res.status(201).json(
      new ApiResponse(201, createdUser, "User registered successfully")
    );

    });

export {registerUser};