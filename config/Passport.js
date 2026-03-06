const passportLocal = require("passport-local");
const passport = require("passport");
const loginService = require("../models/User");

let LocalStrategy = passportLocal.Strategy;

/*let initPassportLocal = () => {
  console.log("hell");
    passport.use(
      new LocalStrategy(
        {
          usernameField: "Email",
          passwordField: "Password",
          passReqToCallback: true,
        },
        async (req, Email, Password, done) => {
          try {
            await loginService.findUserByEmail(Email).then(async (user) => {
              if (!user) {
                return done(null,false,{ message: `This user email "${Email}" doesn't exist` });
              }
              if (user) {
                let match = await loginService.comparePassword(Password, user);
                if (match === true) {
                  return done(null, user, null);
                } else {
                  return done(null, false, {message: 'You Have Entered Wrong Password.'});
                }
              }
            });
          } catch (err) {
            return done(null, false, {message:err.message});
          }
        }
      )
    );
};*/


let initPassportLocal = () => {
  console.log("Initializing Passport Local Strategy");

  passport.use(
    new LocalStrategy(
      {
        usernameField: "Email",
        passwordField: "Password",
        passReqToCallback: true,
      },
      async (req, Email, Password, done) => {
        try {
          // Find user by email
          const user = await loginService.findUserByEmail(Email);
          // If no user is found
          if (!user) {
            return done(null, false,{message:`This email "${Email}" is not registered.`});
          }

          // Check password
          const match = await loginService.comparePassword(Password, user);
          if (!match) {
            return done(null, false,{message:`This is incorrect password.`});
          }

          // If everything is okay
          return done(null, user);

        } catch (err) {
          console.log(err)
          // Handle errors
          req.flash("message", "Something went wrong. Please try again.");
          return done(err, false,{message:"Something went wrong. Please try again."});
        }
      }
    )
  );
};


passport.serializeUser((user, done) => {
  done(null, user.Id);
});

passport.deserializeUser(async (Id, done) => {
  await loginService
    .findUserById(Id)
    .then((user) => {
      return done(null, user);
    })
    .catch((error) => {
      return done(error, null);
    });
});

module.exports = initPassportLocal;
