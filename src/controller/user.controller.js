import {asyncHandler} from "../utils/asyncHandler.util.js";
import {ApiError} from "../utils/ApiError.util.js";
import {User} from "../models/user.model.js";
import {uploadOnCloudinary} from "../utils/cloudinary.util.js";
import {ApiResponse} from "../utils/ApiResponse.util.js";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

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
    console.log("email: ", email);

    if (!username && !email) {
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

const refreshAccessToken = asyncHandler(async (req, res) => {
    const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken;

    if (!incomingRefreshToken) {
        throw new ApiError(401, "Unauthorized request");
    }

    try {
        const decodedRefreshToken = jwt.verify(incomingRefreshToken, process.env.REFRESH_TOKEN_SECRET);

        const user = await User.findById(decodedRefreshToken?._id);

        if (!user) {
            throw new ApiError(401, "Invalid Request Token");
        }

        if (incomingRefreshToken !== user.refreshToken) {
            throw new ApiError(401, "Refresh token expired");
        }

        const options = {
            httpOnly: true,
            secure: true,
        };

        const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(user._id);

        return res
          .status(200)
          .cookie("accessToken", accessToken, options)
          .cookie("refreshToken", refreshToken, options)
          .json(
            new ApiResponse(200, {
                  accessToken, refreshToken: decodedRefreshToken,
              },
              "Access token refreshed"),
          );
    } catch (error) {
        throw new ApiError(401, error?.message || "Invalid refresh token");
    }
});

const changeCurrentPassword = asyncHandler(async (req, res) => {
    const {oldPassword, newPassword, confPassword} = req.body; // obtain both passwords from the client user

    // check for the old password
    const user = await User.findById(req.user._id); // user variable got the old password from db
    const isPasswordCorrect = await user.isPasswordCorrect(oldPassword); // compare the given one with the old one

    if (!(newPassword === confPassword)) {
        throw new ApiError(400, "New password does not match with the confirmed password");
    }

    if (!isPasswordCorrect) {
        throw new ApiError(400, "Invalid password");
    }

    // set the new password and save it to db
    user.password = newPassword;
    await user.save({validateBeforeSave: false});

    // send response to the client user
    return res
            .status(200)
            .json(new ApiResponse(200, {}, "Password changed successfully"));
});

const getCurrentUser = asyncHandler(async (req, res) => {
    return res
      .status(200)
      .json(new ApiResponse(200, req.user, "Current user fetched successfully"));
});

const updateAccountDetails = asyncHandler(async (req, res) => {
    const { fullName, email } = req.body;

    if (!fullName || !email) {
        throw new ApiError(400, "All field are required");
    }

    // obtain updated user object from db using user id received from req.user coming from auth middleware
    const user = await User.findByIdAndUpdate(
      req.user?._id,
      {
          $set: {
              fullName: fullName,
              email: email
          }
      },
      {new: true}
    ).select("-password");

    return res
      .status(200)
      .json(new ApiResponse(200, user, "Account details updated successfully"));
});

const updateUserAvatar = asyncHandler(async (req, res) => {
    const avatarLocalPath = req.file?.path;

    if (!avatarLocalPath) {
        throw new ApiError(400, "Avatar file is not uploaded");
    }

    const avatar = await uploadOnCloudinary(avatarLocalPath);

    if (!avatar.url) {
        throw new ApiError(500, "Avatar file upload failed");
    }

    const user = await User.findByIdAndUpdate(
      req.user?._id,
      {
          $set: {
              avatar: avatar.url
          }
      },
      {new: true}
    ).select("-password");

    if (!user) {
        throw new ApiError(500, "User does not exist for uploading this file");
    }

    return res
      .status(200)
      .json(new ApiResponse(200, user, "Avatar file uploaded successfully"));

});

const updateUserCoverImage = asyncHandler(async (req, res) => {
    const coverImageLocalPath = req.file?.path;

    if (!coverImageLocalPath) {
        throw new ApiError(400, "Cover image file is not uploaded");
    }

    const coverImage = await uploadOnCloudinary(coverImageLocalPath);

    if (!coverImage.url) {
        throw new ApiError(500, "Cover image file upload failed");
    }

    const user = await User.findByIdAndUpdate(
      req.user?._id,
      {
          $set: {
              coverImage: coverImage.url
          }
      },
      {new: true}
    ).select("-password");

    if (!user) {
        throw new ApiError(500, "User does not exist for uploading this file");
    }

    return res
      .status(200)
      .json(new ApiResponse(200, user, "Cover image file uploaded successfully"));
});

const getUserChannelProfile = asyncHandler(async (req, res)=> {
    const { username } = req.params;

    if (!username?.trim()) {
        throw new ApiError(500, "User name not retrieved");
    }

    const channel = await User.aggregate([
        {
            $match: {
                username: username?.toLowerCase()
            }
        },
        {
            $lookup: {
                from: "subscriptions",
                localField: "_id",
                foreignField: "channel",
                as: "subscribers"
            }
        },
        {
            $lookup: {
                from: "subscriptions",
                localField: "_id",
                foreignField: "subscriber",
                as: "subscribedTo"
            }
        },
        {
            $addFields: {
                subscribersCount: {
                    $size: "$subscribers"
                },
                channelsSubscribedToCount: {
                    $size: "$subscribedTo"
                },
                isSubscribed: {
                    $cond: {
                        if: {$in: [req.user?._id, "$subscribers.subscriber"]},
                        then: true,
                        else: false
                    }
                }
            }
        },
        {
            $project: {
                fullName: 1,
                username: 1,
                subscribersCount: 1,
                channelsSubscribedToCount: 1,
                isSubscribed: 1,
                avatar: 1,
                coverImage: 1,
                email: 1
            }
        }
    ]);
    console.log(channel);

    if (!channel?.length) {
        throw new ApiError(404, "Channel does not exist");
    }

    return res
      .status(200)
      .json(new ApiResponse(200, channel[0], "User channel fetched successfully"));
});

const getWatchHistory = asyncHandler(async (req, res)=> {
    const user = await User.aggregate([
        {
            $match: new mongoose.Types.ObjectId(req.user._id)
        },
        {
            $lookup: {
                from: "videos",
                localField: "watchHistory",
                foreignField: "_id",
                as: "watchHistory",
                pipeline: [
                    {
                        $lookup: {
                            from: "videos",
                            localField: "owner",
                            foreignField: "_id",
                            as: "owner",
                            pipeline: [
                                {
                                    $project: {
                                        fullName: 1,
                                        username: 1,
                                        avatar: 1
                                    }
                                }
                            ]
                        }
                    },
                    {
                        $addFields: {
                            owner: {
                                $first: "$owner"
                            }
                        }
                    }
                ]
            }
        }
    ])

    return res.status(200).json(
      new ApiResponse(
        200,
        user[0].watchHistory,
        "Watch history fetched successfully"
      )
    )
})

export {
    registerUser,
    loginUser,
    logoutUser,
    refreshAccessToken,
    changeCurrentPassword,
    getCurrentUser,
    updateAccountDetails,
    updateUserAvatar,
    updateUserCoverImage,
    getUserChannelProfile,
    getWatchHistory
};