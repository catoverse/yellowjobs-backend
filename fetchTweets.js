const Tweet = require("./models/Tweet.schema");
const Meta = require("./models/Meta.schema");
const fetch = require("node-fetch");
const { parse, resourceTypes, categories } = require("./parser");

const MAX_RESULTS = 100;

const resourceQueries = {
    "Bed" : "(bed OR beds)",
    "Icu" : "icu",
    "Ventilator" : "(ventilator OR ventilators)",
    "Oxygen Bed" : "(oxygen bed OR oxygen beds)",
    "Remdesivir" : "(remdesivir OR remdesvir)",
    "Favipiravir" : "(Favipiravir OR FabiFlu)",
    "Tocilizumab": "(tocilizumab OR toclizumab)",
    "Plasma": "(plasma)",
    "Food": "(food OR meal OR meals OR tiffin)",
    "Ambulance" : "ambulance",
    "Oxygen Cylinder" : "(cylinder OR cylinders OR oxygen or O2)",
    "Oxygen Concentrator" : "(concentrator OR concentrators OR bipap)",
    "Covid Test" : "covid test",
    "Helpline" : "(helpline OR war room OR warroom)"
};

const fetchSearchResults = async (newestID, resource) => {
  const url = `https://api.twitter.com/1.1/search/tweets.json?${newestID ? `since_id=${newestID}&` : ""}q=verified ${resourceQueries[resource]} -"request" -"requests" -"requesting" -"needed" -"needs" -"need" -"seeking" -"seek" -"not verified" -"looking" -"unverified" -"urgent" -"urgently" -"urgently required" -"send" -"help" -"get" -"old" -"male" -"female" -"saturation" -filter:retweets -filter:quote&count=${MAX_RESULTS}&tweet_mode=extended&include_entities=false`;
  
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: "Bearer " + process.env.BEARER_TOKEN,
    },
  }).then((res) => res.json());

  return response;
};

const buildTweetObject = (tweet) => {
  const data = parse(tweet.full_text || tweet.text);

  return {
    category: data.categories[0],
    resource_type: data.resource_types[0],
    state: (data.locations[0] && data.locations[0].state) || null,
    district: (data.locations[0] && data.locations[0].city) || null,
    city: (data.locations[0] && data.locations[0].city) || null,
    phone: data.phone_numbers,
    email: data.emails,
    verification_status: data.verification_status,
    last_verified_on: data.verified_at,
    created_by: tweet.user.name,
    created_on: new Date(tweet.created_at).getTime(),
    tweet_id: tweet.id_str,
    tweet_url: `https://twitter.com/${tweet.user.screen_name}/status/${tweet.id_str}`,
    author_id: tweet.user.id_str,
    text: tweet.full_text,
    likes: tweet.favorite_count,
    retweets: tweet.retweet_count,
    author_followers: tweet.user.followers_count,
  };
};

const fetchTweets = async () => {
  let newestID = Number((await Meta.findOne({})).sinceId);
  let max_id = newestID;

  await Promise.all(Object.keys(resourceTypes).map(async resource => {
    const apiRes = await fetchSearchResults(newestID, resource);

    const tweets = apiRes.statuses
      .filter(status => {
        // save tweet only if the followers count of the author is more than 30 and has 2 months old or the author has more than 200 followers
        const followers = status.user.followers_count;
        const accountAge = Date.now() - new Date(status.created_at).getTime();

        const isValid = (followers > 30 && accountAge > 1000*60*60*24*60) || followers > 200;

        if(!isValid){
            console.log("Tweet discarded:");
            console.log(status);
        }
        return isValid;
      })
      .map(tweet => buildTweetObject(tweet));

      if (apiRes.search_metadata.max_id > max_id) {
        max_id = apiRes.search_metadata.max_id;
      }
      //let promises = [];

      for (let tweet of tweets) {
        if (!tweet.resource_type) {
          tweet.resource_type = resource;
          tweet.category = categories[resource][0] || null;
        }
        // console.log(tweet);
        let query = !(tweet.phone.length > 0)
          ? { text: tweet.text }
          : {
              $or: [
                { text: tweet.text },
                { phone: { $all: tweet.phone } },
              ],
            };


        var resp = await Tweet.findOneAndUpdate(query, tweet, { upsert: true });
        
        //     if(promises.length == 20){
        //         console.log(await Promise.all(promises));
        //         promises = [];
        //     }
      }
      //await Promise.all(promises);
    })
  );

  await Meta.updateOne({}, { sinceId: String(max_id) });
};

module.exports = { fetchTweets };
