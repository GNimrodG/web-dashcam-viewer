import Typography from "@mui/joy/Typography";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import type { FunctionComponent } from "react";
import type { VideoPair } from "../api";

interface PairLocationProps {
  pair: VideoPair;
}

/**
 * Displays formatted location information for a video pair.
 * Shows city names with arrows for routes, and includes country names when appropriate.
 */
const PairLocation: FunctionComponent<PairLocationProps> = ({ pair }) => {
  const { startCity, endCity, startCountry, endCountry } = pair;

  // Don't render anything if no location data
  if (!startCity && !endCity) {
    return null;
  }

  const hasDifferentCities = startCity && endCity && startCity !== endCity;
  const hasDifferentCountries =
    startCountry && endCountry && startCountry !== endCountry;
  const onlyOneCity = !hasDifferentCities;
  const showCountry = onlyOneCity || hasDifferentCountries;

  const renderContent = () => {
    if (hasDifferentCities) {
      if (hasDifferentCountries) {
        return (
          <>
            {startCity}, {startCountry}{" "}
            <ArrowForwardIcon
              sx={{
                fontSize: "0.875rem",
                verticalAlign: "middle",
              }}
            />{" "}
            {endCity}, {endCountry}
          </>
        );
      }

      // Same country, different cities
      const country = startCountry || endCountry;
      return country ? (
        <>
          {startCity}{" "}
          <ArrowForwardIcon
            sx={{
              fontSize: "0.875rem",
              verticalAlign: "middle",
            }}
          />{" "}
          {endCity}, {country}
        </>
      ) : (
        <>
          {startCity}{" "}
          <ArrowForwardIcon
            sx={{
              fontSize: "0.875rem",
              verticalAlign: "middle",
            }}
          />{" "}
          {endCity}
        </>
      );
    }

    // Single city or same start/end city
    const city = startCity || endCity;
    const country = startCountry || endCountry;
    return showCountry && country ? `${city}, ${country}` : city;
  };

  return (
    <Typography level="body-sm" fontStyle="italic">
      {renderContent()}
    </Typography>
  );
};

export default PairLocation;
