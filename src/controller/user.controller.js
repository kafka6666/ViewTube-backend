import {asyncHandler} from "../utils/asyncHandler.util.js";
import {ApiError} from "../utils/ApiError.util.js";
import {User} from "../models/user.model.js";
import {uploadOnCloudinary} from "../utils/cloudinary.util.js";
import {ApiResponse} from "../utils/ApiResponse.util.js";

const generateAccessAndRefreshTokens = async (userId) => {
    try {
        const user = await User.findById(userId);
        const accessToken = user.generateAccessToken();
        const refreshToken = user.generateRefreshToken();

        user.refreshToken = refreshToken;
        await user.save({validateBeforeSave: false});

        return {accessToken, refreshToken};

    } catch (error) {
        throw new ApiError(500, "Access and/or Refresh Tokens generation failed");
    }
};

const registerUser = asyncHandler(async (req, res) => {
    // get user data from the frontend client
    const {fullName, username, email, password} = req.body;
    // console.log("email: ", email);

    // validate the user data - check if all fields are not null
    if ([fullName, username, email, password].some((field) => field === "")) {
        throw new ApiError(400, "All fields are required");
    }

    // check if the user already exists using username and email
    const existingUser = await User.findOne({
        $or: [{username}, {email}],
    });

    if (existingUser) {
        throw new ApiError(409, "User already exists");
    }

    console.log("req.files: ", req.files);

    // check for images and avatars
    const avatarLocalPath = req.files?.avatar[0]?.path;

    // const coverImageLocalPath = req.files?.coverImage[0]?.path;
    let coverImageLocalPath;
    if (req.files && Array.isArray(req.files.coverImage) && req.files.coverImage.length > 0) {
        coverImageLocalPath = req.files.coverImage[0].path;
    }

    if (!avatarLocalPath) {
        throw new ApiError(400, "Avatar file is required");
    }

    // if available, upload the images and avatars to cloudinary and check whether the avatar upload was successful
    const avatar = await uploadOnCloudinary(avatarLocalPath);
    const coverImage = await uploadOnCloudinary(coverImageLocalPath);
    // console.log("coverImage: ", coverImage);

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

const loginUser = asyncHandler(async (req, res) => {
    // get user data from req.body received from the client
    const {username, email, password} = req.body;

    if (!username || !email) {
        throw new ApiError(400, "username or email is required");
    }

    // retrieve the user info using username or email
    const user = await User.findOne({
        $or: [{email}, {username}],
    });

    // check whether the user exists in our db
    if (!user) {
        throw new ApiError(404, "User does not exist");
    }

    // check whether the password is correct
    const isPasswordValid = await user.isPasswordCorrect(password);
    if (!isPasswordValid) {
        throw new ApiError(401, "Invalid user credentials");
    }

    // generate access token and refresh token
    const {accessToken, refreshToken}= await generateAccessAndRefreshTokens(user._id);

    // send those tokens back to the user client using cookies
    const loggedInUser =  await User.findById(user._id).select(
      "-password -refreshToken"
    );

    const options = {
        httpOnly: true,
        secure: true
    };

    return res
      .status(200)
      .cookie("accessToken", accessToken, options)
      .cookie("refreshToken", refreshToken, options)
      .json(new ApiResponse(200,
        {
          user: loggedInUser,
          accessToken,
          refreshToken
        },
        "User logged in successfully"
      ));
});

const logoutUser = asyncHandler(async (req, res) => {
    await User.findByIdAndUpdate(req.user._id,
      {
          $set: {refreshToken: undefined},
      },
      {
          new: true,
          runValidators: true,
      }
    );

    const options = {
        httpOnly: true,
        secure: true,
    };

    return res
      .status(200)
      .clearCookie("accessToken", options)
      .clearCookie("refreshToken", options)
      .json(new ApiResponse(200, {}, "User logged out successfully"));
});

export {registerUser, loginUser, logoutUser};