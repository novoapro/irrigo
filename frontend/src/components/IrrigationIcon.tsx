import sprinklerSvg from "../assets/sprinkler.svg?raw";

const enhanceSvgMarkup = (svgMarkup: string) =>
  svgMarkup.replace("<svg", '<svg fill="currentColor"');

const IrrigationIcon = ({ className }: { className?: string }) => (
  <span
    className={`irrigation-icon${className ? ` ${className}` : ""}`}
    aria-hidden="true"
    dangerouslySetInnerHTML={{ __html: enhanceSvgMarkup(sprinklerSvg) }}
  />
);

export default IrrigationIcon;
